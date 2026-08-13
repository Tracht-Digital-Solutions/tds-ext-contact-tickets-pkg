<?php
/**
 * API documentation for this module's routes — consumed through `ApiDocSource`
 * and rendered in the admin frontend's API reference (`GET /wiki.json`).
 *
 * `pattern` must match the Slim pattern in `register()` VERBATIM, inline regex
 * included: it is the join key for the route introspection.
 * `php/tests/ContactTicketsApiDocsTest.php` fails the build if the documented
 * set and the registered set drift apart in either direction.
 */

declare(strict_types=1);

return [
    [
        'method' => 'POST',
        'pattern' => '/contact',
        'tag' => 'Öffentlich',
        'summary' => 'Kontaktformular absenden',
        'description' => 'Die einzige öffentliche Route dieses Moduls — die Marketing-Seite '
            . 'sendet hier ohne Anmeldung hin. Drei Schutzschichten: ein Honeypot-Feld '
            . '`website` (gefüllt ⇒ Bot, wird **stillschweigend mit 202 bestätigt**, '
            . 'damit der Bot nichts lernt), eine Mindestlänge-Validierung und ein '
            . 'Rate-Limit von 5 Einsendungen je IP in 10 Minuten. Die IP wird nur '
            . 'gesalzen gehasht gespeichert, nie im Klartext. Der Admin wird per '
            . 'E-Mail benachrichtigt (best effort — ein nicht konfigurierter Mailer '
            . 'lässt die Anfrage trotzdem gelingen).',
        'auth' => 'public',
        'params' => [
            ['in' => 'body', 'name' => 'name', 'type' => 'string', 'required' => true, 'description' => 'Mindestens 2 Zeichen.'],
            ['in' => 'body', 'name' => 'email', 'type' => 'string', 'required' => true, 'description' => 'Muss eine gültige Adresse sein; wird kleingeschrieben gespeichert.'],
            ['in' => 'body', 'name' => 'message', 'type' => 'string', 'required' => true, 'description' => 'Mindestens 20 Zeichen, auf 10.000 gekürzt.'],
            ['in' => 'body', 'name' => 'company', 'type' => 'string', 'description' => 'Optional, auf 200 Zeichen gekürzt.'],
            ['in' => 'body', 'name' => 'subject', 'type' => 'string', 'description' => 'Optional, auf 200 Zeichen gekürzt.'],
            ['in' => 'body', 'name' => 'website', 'type' => 'string', 'description' => 'Honeypot — muss leer bleiben. Im Formular versteckt.'],
        ],
        'responses' => [
            ['status' => 201, 'description' => '`{id}` der gespeicherten Anfrage.'],
            ['status' => 202, 'description' => '`{ok: true}` — Honeypot ausgelöst. Nichts wurde gespeichert.'],
            ['status' => 422, 'description' => 'Name, E-Mail oder Nachricht genügen den Mindestanforderungen nicht.'],
            ['status' => 429, 'description' => 'Rate-Limit überschritten (5 pro IP je 10 Minuten).'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/contact/summary',
        'tag' => 'Posteingang',
        'summary' => 'Anzahl neuer Kontaktanfragen',
        'description' => 'Die `dataEndpoint`-Route des Dashboard-Widgets.',
        'permission' => 'contact:read',
        'responses' => [
            ['status' => 200, 'description' => '`{new: <Anzahl im Status `new`>}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `contact:read`.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/contact/messages',
        'tag' => 'Posteingang',
        'summary' => 'Kontaktanfragen auflisten, filtern und sortieren',
        'description' => 'Jeder Parameter läuft gegen eine Positivliste, und ein unbekannter '
            . 'Wert fällt auf die Vorgabe zurück statt 422 zu erzeugen: die Werte kommen '
            . 'aus Chips und Selects, ein falscher heißt also „veraltetes Lesezeichen", '
            . 'nicht „fehlerhafter Aufrufer". Die wirksamen Filter werden in `query` '
            . 'zurückgegeben — ohne das sieht „keine Treffer für diesen Filter" genauso '
            . 'aus wie „der Server hat meinen Filter ignoriert".',
        'permission' => 'contact:read',
        'params' => [
            ['in' => 'query', 'name' => 'status', 'type' => 'new|handled|spam', 'description' => 'Auf einen Status einschränken.'],
            ['in' => 'query', 'name' => 'q', 'type' => 'string', 'description' => 'Freitextsuche, auf 120 Zeichen gekürzt.'],
            ['in' => 'query', 'name' => 'sort', 'type' => 'string', 'description' => 'Sortierschlüssel aus `ContactRepository::sortKeys()`. Vorgabe `created_at`.'],
            ['in' => 'query', 'name' => 'dir', 'type' => 'asc|desc', 'description' => 'Vorgabe `desc` — alles außer `asc` bedeutet absteigend.'],
            ['in' => 'query', 'name' => 'limit', 'type' => 'int', 'description' => 'Vorgabe 200. Werte ≤ 0 werden auf 200 zurückgesetzt.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{messages: [...], query: {status, q, sort, dir}}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `contact:read`.'],
        ],
    ],
    [
        'method' => 'GET',
        'pattern' => '/contact/messages/{id:[0-9]+}',
        'tag' => 'Posteingang',
        'summary' => 'Eine Kontaktanfrage samt Antworten lesen',
        'description' => 'Der IP-Hash aus dem Rate-Limit wird bewusst entfernt und nie '
            . 'ausgeliefert.',
        'permission' => 'contact:read',
        'params' => [
            ['in' => 'path', 'name' => 'id', 'type' => 'int', 'required' => true, 'description' => 'Id der Anfrage.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => 'Die Anfrage plus `replies: [...]`.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `contact:read`.'],
            ['status' => 404, 'description' => 'Unbekannte Id.'],
        ],
    ],
    [
        'method' => 'POST',
        'pattern' => '/contact/messages/{id:[0-9]+}/reply',
        'tag' => 'Posteingang',
        'summary' => 'Per E-Mail auf eine Kontaktanfrage antworten',
        'description' => 'Versendet die Antwort über den Core-Mailer an die Adresse des '
            . 'Absenders und protokolliert sie an der Anfrage. **Eine Antwort setzt den '
            . 'Status von `new` auf `handled`.** Ohne konfigurierten Mailer 503 — die '
            . 'Antwort wird dann auch nicht protokolliert, damit der Verlauf keine '
            . 'nie versendete Nachricht behauptet.',
        'permission' => 'contact:write',
        'params' => [
            ['in' => 'path', 'name' => 'id', 'type' => 'int', 'required' => true, 'description' => 'Id der Anfrage.'],
            ['in' => 'body', 'name' => 'body', 'type' => 'string', 'required' => true, 'description' => 'Mindestens 2 Zeichen, auf 10.000 gekürzt.'],
        ],
        'responses' => [
            ['status' => 201, 'description' => '`{ok: true}` — versendet und protokolliert.'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `contact:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Id.'],
            ['status' => 422, 'description' => 'Antworttext fehlt oder ist zu kurz.'],
            ['status' => 503, 'description' => 'Kein SMTP konfiguriert — nichts versendet, nichts protokolliert.'],
        ],
    ],
    [
        'method' => 'PATCH',
        'pattern' => '/contact/messages/{id:[0-9]+}',
        'tag' => 'Posteingang',
        'summary' => 'Status einer Kontaktanfrage setzen',
        'permission' => 'contact:write',
        'params' => [
            ['in' => 'path', 'name' => 'id', 'type' => 'int', 'required' => true, 'description' => 'Id der Anfrage.'],
            ['in' => 'body', 'name' => 'status', 'type' => 'new|handled|spam', 'required' => true, 'description' => 'Neuer Status.'],
        ],
        'responses' => [
            ['status' => 200, 'description' => '`{ok: true}`'],
            ['status' => 401, 'description' => 'Keine Sitzung.'],
            ['status' => 403, 'description' => 'Kein `contact:write`.'],
            ['status' => 404, 'description' => 'Unbekannte Id.'],
            ['status' => 422, 'description' => 'Status ist nicht `new`, `handled` oder `spam`.'],
        ],
    ],
];
