<?php
declare(strict_types=1);

namespace Tds\Ext\ContactTickets\Tests;

use DI\Container;
use PHPUnit\Framework\TestCase;
use Slim\Factory\AppFactory;
use Slim\Psr7\Factory\ServerRequestFactory;
use Tds\Ext\ContactTickets\ContactTicketsModule;
use Tds\Frontend\Contract\UserContext;

/** Configurable UserContext double. */
final class FakeUser implements UserContext
{
    /** @param string[] $perms */
    public function __construct(private bool $auth = true, private bool $admin = false, private array $perms = [])
    {
    }

    public function isAuthenticated(): bool
    {
        return $this->auth;
    }

    public function userId(): ?int
    {
        return 1;
    }

    public function email(): ?string
    {
        return null;
    }

    public function isAdmin(): bool
    {
        return $this->admin;
    }

    /** @return string[] */
    public function permissions(): array
    {
        return $this->perms;
    }

    public function has(string $permission): bool
    {
        return $this->admin || in_array($permission, $this->perms, true);
    }

    public function activeCompanyId(): ?int
    {
        return null;
    }
}

/** Route + RBAC + validation coverage without a DB (all tested paths short-circuit before the repo). */
final class ContactTicketsModuleTest extends TestCase
{
    private function appWith(UserContext $user): \Slim\App
    {
        $container = new Container();
        $container->set(UserContext::class, $user);
        AppFactory::setContainer($container);
        $app = AppFactory::create();
        $app->addBodyParsingMiddleware();
        $app->addRoutingMiddleware();
        (new ContactTicketsModule())->register($app);
        return $app;
    }

    private function get(\Slim\App $app, string $path): \Psr\Http\Message\ResponseInterface
    {
        return $app->handle((new ServerRequestFactory())->createServerRequest('GET', $path));
    }

    /** @param array<string,mixed> $body */
    private function post(\Slim\App $app, string $path, array $body): \Psr\Http\Message\ResponseInterface
    {
        return $app->handle(
            (new ServerRequestFactory())->createServerRequest('POST', $path)->withParsedBody($body)
        );
    }

    public function testMetadata(): void
    {
        $module = new ContactTicketsModule();
        self::assertSame('contact-tickets', $module->id());
        $ids = array_map(static fn ($p): string => $p->id, $module->permissions());
        self::assertSame(['contact:read', 'contact:write'], $ids);
        self::assertDirectoryExists($module->migrations()[0]);
    }

    public function testPublicSubmitValidatesPayload(): void
    {
        $res = $this->post($this->appWith(new FakeUser(auth: false)), '/contact', [
            'name' => 'A',
            'email' => 'bad',
            'message' => 'short',
        ]);
        self::assertSame(422, $res->getStatusCode());
    }

    public function testHoneypotSilentlyAccepts(): void
    {
        $res = $this->post($this->appWith(new FakeUser(auth: false)), '/contact', [
            'name' => 'Bot',
            'email' => 'bot@x.de',
            'message' => 'a fairly long spam message body here',
            'website' => 'http://spam',
        ]);
        self::assertSame(202, $res->getStatusCode());
    }

    public function testSummaryRequiresReadPermission(): void
    {
        self::assertSame(401, $this->get($this->appWith(new FakeUser(auth: false)), '/contact/summary')->getStatusCode());
        self::assertSame(403, $this->get($this->appWith(new FakeUser(perms: [])), '/contact/summary')->getStatusCode());
    }

    public function testMessagesRequireRead(): void
    {
        self::assertSame(403, $this->get($this->appWith(new FakeUser(perms: [])), '/contact/messages')->getStatusCode());
    }

    public function testReplyRequiresWrite(): void
    {
        // Unauthenticated → 401, authenticated-but-read-only → 403, both before the repo.
        self::assertSame(401, $this->post($this->appWith(new FakeUser(auth: false)), '/contact/messages/1/reply', ['body' => 'hi'])->getStatusCode());
        self::assertSame(403, $this->post($this->appWith(new FakeUser(perms: ['contact:read'])), '/contact/messages/1/reply', ['body' => 'hi'])->getStatusCode());
    }

    // --- notification feed ---------------------------------------------------

    public function testNotificationsWithoutPermissionYieldNothing(): void
    {
        // No container bound yet either — the point is that it answers with a
        // shape rather than throwing, because the base's feed (and with it the
        // shell's poll on EVERY page) must not depend on this module behaving.
        $result = (new ContactTicketsModule())->notifications(new FakeUser(perms: []), '5');
        self::assertSame([], $result['items']);
        self::assertArrayHasKey('cursor', $result);
    }

    public function testNotificationsNeverThrowWithoutADatabase(): void
    {
        // A frontend service that boots without DB config is a supported state
        // (see the core's Bootstrap). The poller still runs on every page.
        $app = $this->appWith(new FakeUser(admin: true));
        $module = new ContactTicketsModule();
        $module->register($app);

        $result = $module->notifications(new FakeUser(admin: true), '5');
        self::assertSame([], $result['items']);
        // The cursor it was handed comes back, so a later working poll picks up
        // where this one left off instead of replaying the backlog.
        self::assertSame('5', $result['cursor']);
    }

    public function testTheModuleIsANotificationSource(): void
    {
        // The base discovers sources by instanceof; losing the interface would
        // silently take contact requests out of the feed with nothing failing.
        self::assertInstanceOf(
            \Tds\Frontend\Contract\NotificationSource::class,
            new ContactTicketsModule(),
        );
    }

    // --- list query ----------------------------------------------------------

    public function testSortKeysAreAnAllowList(): void
    {
        // The list endpoint maps `sort` through this; anything outside it must
        // never reach an ORDER BY.
        $keys = \Tds\Ext\ContactTickets\Domain\ContactRepository::sortKeys();
        self::assertSame(['created_at', 'name', 'email', 'company', 'status'], $keys);
        self::assertNotContains('message', $keys);
        self::assertNotContains('ip_hash', $keys);
    }
}
