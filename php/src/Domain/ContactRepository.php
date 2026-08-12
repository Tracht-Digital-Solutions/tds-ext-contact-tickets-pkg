<?php
declare(strict_types=1);

namespace Tds\Ext\ContactTickets\Domain;

use PDO;

/** Contact-form inbox data access. */
final class ContactRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function newCount(): int
    {
        return (int) $this->pdo->query("SELECT COUNT(*) FROM contact_message WHERE status = 'new'")->fetchColumn();
    }

    /**
     * Sortable columns, keyed by the value the API accepts.
     *
     * An allow-list, NOT a pass-through: nothing else in this codebase builds a
     * dynamic ORDER BY, and interpolating a query parameter into one is how
     * that would first go wrong. `id` is the tiebreaker everywhere so a page of
     * equal names has a stable order instead of shuffling between polls.
     */
    private const SORTABLE = [
        'created_at' => 'created_at',
        'name' => 'name',
        'email' => 'email',
        'company' => 'company',
        'status' => 'status',
    ];

    /** Rows one list call may return, however high a caller asks. */
    public const MAX_LIMIT = 500;

    /** Characters of the message body carried in the list payload. */
    private const EXCERPT_CHARS = 160;

    /**
     * Inbox list: filter by status and/or free text, sorted, capped.
     *
     * `excerpt` rides along because the public form has no subject field
     * (`ContactSchema` does not define one), so every row would otherwise read
     * "Ohne Betreff" and have to be opened to be triaged at all.
     *
     * @param string|null $status one of the module's STATUSES, or null for all
     * @param string|null $q      free text over name/email/company/subject
     * @param string      $sort   a key of {@see SORTABLE}
     * @param bool        $desc   descending (default — newest first)
     * @return list<array<string,mixed>>
     */
    public function list(
        ?string $status,
        ?string $q = null,
        string $sort = 'created_at',
        bool $desc = true,
        int $limit = 200,
    ): array {
        $column = self::SORTABLE[$sort] ?? 'created_at';
        $direction = $desc ? 'DESC' : 'ASC';
        $limit = max(1, min($limit, self::MAX_LIMIT));

        $sql = 'SELECT id, name, email, company, subject, status, created_at,
                       SUBSTRING(message, 1, ' . self::EXCERPT_CHARS . ') AS excerpt
                FROM contact_message';
        $where = [];
        $params = [];
        if ($status !== null) {
            $where[] = 'status = :s';
            $params[':s'] = $status;
        }
        if ($q !== null && $q !== '') {
            // Escape the LIKE wildcards themselves — a search for "50%" must
            // not silently match everything.
            $needle = '%' . addcslashes($q, '%_\\') . '%';
            $where[] = '(name LIKE :q OR email LIKE :q OR company LIKE :q OR subject LIKE :q)';
            $params[':q'] = $needle;
        }
        if ($where !== []) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        // $column/$direction come from the allow-lists above; $limit is an int.
        $sql .= " ORDER BY {$column} {$direction}, id {$direction} LIMIT {$limit}";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /** The sort keys the API accepts. @return list<string> */
    public static function sortKeys(): array
    {
        return array_keys(self::SORTABLE);
    }

    /**
     * Messages newer than $afterId, oldest first — the notification feed's
     * cursor read. Oldest first so a burst is announced in arrival order and
     * the cursor can simply take the last id.
     *
     * @return list<array<string,mixed>>
     */
    public function listSince(int $afterId, int $limit): array
    {
        $limit = max(1, min($limit, 50));
        $stmt = $this->pdo->prepare(
            "SELECT id, name, email, company, subject, created_at
             FROM contact_message
             WHERE id > :after AND status = 'new'
             ORDER BY id ASC LIMIT {$limit}",
        );
        $stmt->execute([':after' => $afterId]);
        return $stmt->fetchAll();
    }

    /** Highest message id, or 0 on an empty table (the feed's starting cursor). */
    public function maxId(): int
    {
        return (int) $this->pdo->query('SELECT COALESCE(MAX(id), 0) FROM contact_message')->fetchColumn();
    }

    /** @return array<string,mixed>|null */
    public function find(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM contact_message WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** Admin replies to a message, newest first. @return list<array<string,mixed>> */
    public function replies(int $messageId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, body, sent_by, created_at FROM contact_reply
             WHERE message_id = :id ORDER BY created_at DESC'
        );
        $stmt->execute([':id' => $messageId]);
        return $stmt->fetchAll();
    }

    /** Submissions from one IP hash within the trailing window (rate-limit probe). */
    public function recentFromIp(string $ipHash, int $windowSeconds): int
    {
        // Cutoff computed in PHP — a placeholder inside `INTERVAL ? SECOND` is
        // driver-fragile, a plain datetime comparison is portable.
        $cutoff = date('Y-m-d H:i:s', time() - $windowSeconds);
        $stmt = $this->pdo->prepare(
            'SELECT COUNT(*) FROM contact_message WHERE ip_hash = :h AND created_at >= :cut'
        );
        $stmt->execute([':h' => $ipHash, ':cut' => $cutoff]);
        return (int) $stmt->fetchColumn();
    }

    public function create(string $name, string $email, ?string $company, ?string $subject, string $message, ?string $ipHash = null): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO contact_message (name, email, company, subject, message, ip_hash)
             VALUES (:n, :e, :c, :s, :m, :ip)'
        );
        $stmt->execute([':n' => $name, ':e' => $email, ':c' => $company, ':s' => $subject, ':m' => $message, ':ip' => $ipHash]);
        return (int) $this->pdo->lastInsertId();
    }

    public function addReply(int $messageId, string $body, ?string $sentBy): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO contact_reply (message_id, body, sent_by) VALUES (:id, :b, :by)'
        );
        $stmt->execute([':id' => $messageId, ':b' => $body, ':by' => $sentBy]);
        return (int) $this->pdo->lastInsertId();
    }

    public function setStatus(int $id, string $status): void
    {
        $handled = $status === 'new' ? null : date('Y-m-d H:i:s');
        $stmt = $this->pdo->prepare('UPDATE contact_message SET status = :s, handled_at = :h WHERE id = :id');
        $stmt->execute([':s' => $status, ':h' => $handled, ':id' => $id]);
    }
}
