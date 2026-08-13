<?php
declare(strict_types=1);

namespace Tds\Ext\ContactTickets;

use PDO;
use Psr\Container\ContainerInterface;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;
use Tds\Ext\ContactTickets\Domain\ContactRepository;
use Tds\Frontend\Contract\AbstractModule;
use Tds\Frontend\Contract\ApiDocSource;
use Tds\Frontend\Contract\Email;
use Tds\Frontend\Contract\Mailer;
use Tds\Frontend\Contract\NotificationSource;
use Tds\Frontend\Contract\PermissionDef;
use Tds\Frontend\Contract\UserContext;

/**
 * Backend Module for the contact-form inbox. `POST /contact` is PUBLIC (the
 * marketing site's form submits here) — validated + honeypot-guarded, stored as
 * a contact_message, and (best-effort) the admin is notified via the core Mailer.
 * The admin inbox (`/contact/*`) is gated by `contact:read`/`contact:write`.
 */
final class ContactTicketsModule extends AbstractModule implements NotificationSource, ApiDocSource
{
    private const STATUSES = ['new', 'handled', 'spam'];

    /** Most new requests one notification poll announces. */
    private const NOTIFY_MAX = 10;

    /** Public-form rate limit: at most N submissions per IP per window. */
    private const RATE_MAX = 5;
    private const RATE_WINDOW_SECONDS = 600;

    public function id(): string
    {
        return 'contact-tickets';
    }

    /** @return PermissionDef[] */
    public function permissions(): array
    {
        return [
            new PermissionDef('contact:read', 'Kontaktanfragen ansehen', 'contact-tickets'),
            new PermissionDef('contact:write', 'Kontaktanfragen bearbeiten', 'contact-tickets'),
        ];
    }

    /** @return string[] */
    public function migrations(): array
    {
        return [__DIR__ . '/../db/migrations'];
    }

    /**
     * The app container, kept from {@see register()}.
     *
     * {@see notifications()} is called outside a route, so it has no `$app` to
     * resolve the repository from. The registry holds this module instance for
     * the life of the request, and `registerAll()` always runs at boot, so the
     * reference is set before any feed poll can arrive.
     */
    private ?ContainerInterface $container = null;

    public function register(App $app): void
    {
        $c = $app->getContainer();
        $this->container = $c;
        if ($c !== null && !$c->has(ContactRepository::class)) {
            $c->set(ContactRepository::class, static fn ($c) => new ContactRepository($c->get(PDO::class)));
        }

        // PUBLIC — the marketing contact form submits here (no auth).
        $app->post('/contact', function (Request $req, Response $res) use ($c): Response {
            $body = (array) $req->getParsedBody();
            // Honeypot: a filled hidden "website" field ⇒ bot. Accept silently.
            if (trim((string) ($body['website'] ?? '')) !== '') {
                return self::json($res, ['ok' => true], 202);
            }
            $name = trim((string) ($body['name'] ?? ''));
            $email = strtolower(trim((string) ($body['email'] ?? '')));
            $message = trim((string) ($body['message'] ?? ''));
            if (mb_strlen($name) < 2 || filter_var($email, FILTER_VALIDATE_EMAIL) === false || mb_strlen($message) < 20) {
                return self::json($res, ['error' => 'Invalid contact payload'], 422);
            }
            $repo = $c->get(ContactRepository::class);
            // Rate-limit the public write by hashed client IP (429 when exceeded).
            $ipHash = self::clientIpHash($req);
            if ($ipHash !== null && $repo->recentFromIp($ipHash, self::RATE_WINDOW_SECONDS) >= self::RATE_MAX) {
                return self::json($res, ['error' => 'Too many requests'], 429);
            }
            $company = self::optional($body['company'] ?? null, 200);
            $subject = self::optional($body['subject'] ?? null, 200);
            $id = $repo->create($name, $email, $company, $subject, mb_substr($message, 0, 10000), $ipHash);
            self::notifyAdmin($c->get(Mailer::class), $id, $name, $email);
            return self::json($res, ['id' => $id], 201);
        });

        $app->get('/contact/summary', function (Request $req, Response $res) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'contact:read', $res)) !== null) {
                return $deny;
            }
            return self::json($res, ['new' => $c->get(ContactRepository::class)->newCount()]);
        });

        $app->get('/contact/messages', function (Request $req, Response $res) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'contact:read', $res)) !== null) {
                return $deny;
            }
            $query = $req->getQueryParams();

            // Every parameter goes through an allow-list and an unknown value
            // falls back to the default rather than 422-ing: these come from
            // chips and selects, so a bad one means a stale bookmark, not a
            // caller worth failing.
            $status = $query['status'] ?? null;
            $status = in_array($status, self::STATUSES, true) ? (string) $status : null;

            $q = trim((string) ($query['q'] ?? ''));
            $q = $q === '' ? null : mb_substr($q, 0, 120);

            $sort = (string) ($query['sort'] ?? 'created_at');
            $sort = in_array($sort, ContactRepository::sortKeys(), true) ? $sort : 'created_at';
            $desc = strtolower((string) ($query['dir'] ?? 'desc')) !== 'asc';

            $limit = (int) ($query['limit'] ?? 200);
            $limit = $limit > 0 ? $limit : 200;

            return self::json($res, [
                'messages' => $c->get(ContactRepository::class)->list($status, $q, $sort, $desc, $limit),
                // Echoed back so a client can tell "no results for this filter"
                // from "the server ignored my filter" — the two look identical
                // in an empty list otherwise.
                'query' => ['status' => $status, 'q' => $q, 'sort' => $sort, 'dir' => $desc ? 'desc' : 'asc'],
            ]);
        });

        $app->get('/contact/messages/{id:[0-9]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'contact:read', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(ContactRepository::class);
            $msg = $repo->find((int) $args['id']);
            if ($msg === null) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
            unset($msg['ip_hash']); // never expose the rate-limit hash
            $msg['replies'] = $repo->replies((int) $args['id']);
            return self::json($res, $msg);
        });

        $app->post('/contact/messages/{id:[0-9]+}/reply', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'contact:write', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(ContactRepository::class);
            $id = (int) $args['id'];
            $msg = $repo->find($id);
            if ($msg === null) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
            $reply = trim((string) (((array) $req->getParsedBody())['body'] ?? ''));
            if (mb_strlen($reply) < 2) {
                return self::json($res, ['error' => 'reply body is required'], 422);
            }
            $reply = mb_substr($reply, 0, 10000);
            $mailer = $c->get(Mailer::class);
            if (!$mailer->isConfigured()) {
                return self::json($res, ['error' => 'Mailer not configured'], 503);
            }
            $user = $c->get(UserContext::class);
            $mailer->send(new Email(
                (string) $msg['email'],
                (string) $msg['name'],
                'Re: ' . ((string) ($msg['subject'] ?? 'Ihre Anfrage')),
                '<p>' . nl2br(htmlspecialchars($reply)) . '</p>',
                $reply,
            ));
            $repo->addReply($id, $reply, $user->email() ?? ('#' . (string) ($user->userId() ?? '?')));
            // A reply implies the message is handled.
            if (($msg['status'] ?? '') === 'new') {
                $repo->setStatus($id, 'handled');
            }
            return self::json($res, ['ok' => true], 201);
        });

        $app->patch('/contact/messages/{id:[0-9]+}', function (Request $req, Response $res, array $args) use ($c): Response {
            if (($deny = self::require($c->get(UserContext::class), 'contact:write', $res)) !== null) {
                return $deny;
            }
            $repo = $c->get(ContactRepository::class);
            $id = (int) $args['id'];
            if ($repo->find($id) === null) {
                return self::json($res, ['error' => 'Not found'], 404);
            }
            $status = (string) (((array) $req->getParsedBody())['status'] ?? '');
            if (!in_array($status, self::STATUSES, true)) {
                return self::json($res, ['error' => 'status must be new|handled|spam'], 422);
            }
            $repo->setStatus($id, $status);
            return self::json($res, ['ok' => true]);
        });
    }

    /**
     * New contact requests since the caller's cursor, for the panel's live
     * notification feed. The in-panel twin of {@see notifyAdmin()} — the same
     * event, told to whoever is looking at the panel right now.
     *
     * The cursor is the highest `contact_message.id` seen. An id, not a
     * timestamp: it is monotonic, it is the primary key, and it cannot collide
     * for two rows inserted in the same second.
     *
     * @return array{cursor: string, items: list<array<string,mixed>>}
     */
    public function notifications(UserContext $user, ?string $cursor): array
    {
        $container = $this->container;
        if ($container === null) {
            return ['cursor' => '0', 'items' => []];
        }

        try {
            $repo = $container->get(ContactRepository::class);

            // No permission ⇒ no items, but STILL the cursor: granting
            // `contact:read` tomorrow must not replay everything that arrived
            // in the meantime.
            if (!$user->isAuthenticated() || !$user->has('contact:read')) {
                return ['cursor' => (string) $repo->maxId(), 'items' => []];
            }

            if ($cursor === null) {
                // First call — hand back where we are, announce nothing.
                return ['cursor' => (string) $repo->maxId(), 'items' => []];
            }

            $after = ctype_digit($cursor) ? (int) $cursor : 0;
            $rows = $repo->listSince($after, self::NOTIFY_MAX);

            $items = [];
            $latest = $after;
            foreach ($rows as $row) {
                $id = (int) $row['id'];
                $latest = max($latest, $id);
                $who = trim((string) $row['name']);
                $company = trim((string) ($row['company'] ?? ''));
                $items[] = [
                    'id' => 'contact-tickets:' . $id,
                    'module' => 'contact-tickets',
                    'kind' => 'contact.new',
                    // One line of plain text: the toast has no title and
                    // renders a text node, never HTML.
                    'message' => 'Neue Kontaktanfrage: ' . $who . ($company !== '' ? ' (' . $company . ')' : ''),
                    'href' => '/kontakt?id=' . $id,
                    'variant' => 'info',
                    'created_at' => (string) $row['created_at'],
                ];
            }

            // Only advance past what was actually handed over. Taking maxId()
            // here would skip everything beyond NOTIFY_MAX on a burst.
            return ['cursor' => (string) $latest, 'items' => $items];
        } catch (\Throwable) {
            // No DB configured yet, or a query that failed. The contract says a
            // source must not throw — the feed (and with it the shell's poll on
            // every page) matters more than this module's events.
            return ['cursor' => $cursor ?? '0', 'items' => []];
        }
    }

    // --- helpers ---------------------------------------------------------------

    private static function notifyAdmin(Mailer $mailer, int $id, string $name, string $email): void
    {
        $to = (string) (getenv('CONTACT_ADMIN_EMAIL') ?: getenv('TICKET_ADMIN_EMAIL') ?: '');
        if ($to === '' || !$mailer->isConfigured()) {
            return;
        }
        $mailer->send(new Email(
            $to,
            '',
            "Neue Kontaktanfrage #{$id} von {$name}",
            '<p>Neue Kontaktanfrage über das Formular.</p><p><strong>#' . $id . '</strong> — '
                . htmlspecialchars($name) . ' &lt;' . htmlspecialchars($email) . '&gt;</p>',
            null,
            $email, // Reply-To the submitter
        ));
    }

    /**
     * A salted hash of the client IP for rate-limiting — never the raw IP.
     * Prefers a proxy-forwarded address (Plesk/nginx front the PHP app).
     */
    private static function clientIpHash(Request $req): ?string
    {
        $server = $req->getServerParams();
        $ip = '';
        $fwd = (string) ($server['HTTP_X_FORWARDED_FOR'] ?? '');
        if ($fwd !== '') {
            $ip = trim(explode(',', $fwd)[0]);
        }
        if ($ip === '') {
            $ip = (string) ($server['REMOTE_ADDR'] ?? '');
        }
        if ($ip === '') {
            return null;
        }
        $salt = (string) (getenv('CONTACT_RATE_SALT') ?: getenv('SETTINGS_ENCRYPTION_KEY') ?: 'tds-contact');
        return hash('sha256', $salt . '|' . $ip);
    }

    private static function optional(mixed $value, int $limit): ?string
    {
        $v = trim((string) ($value ?? ''));
        return $v === '' ? null : mb_substr($v, 0, $limit);
    }

    private static function require(UserContext $user, string $permission, Response $res): ?Response
    {
        if (!$user->isAuthenticated()) {
            return self::json($res, ['error' => 'Unauthorized'], 401);
        }
        if (!$user->has($permission)) {
            return self::json($res, ['error' => 'Forbidden'], 403);
        }
        return null;
    }

    private static function json(Response $res, mixed $data, int $status = 200): Response
    {
        $res->getBody()->write(json_encode($data, JSON_THROW_ON_ERROR));
        return $res->withStatus($status)->withHeader('Content-Type', 'application/json');
    }

    /**
     * Route documentation for the admin frontend's API reference. Kept in its
     * own file so the prose does not sit in the middle of the wiring.
     *
     * @return list<array<string, mixed>>
     */
    public function apiDocs(): array
    {
        return require __DIR__ . '/../docs/api.php';
    }
}
