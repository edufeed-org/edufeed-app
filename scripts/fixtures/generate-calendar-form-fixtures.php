<?php

/**
 * Generates the calendar-form interop fixtures for edufeed-app from the
 * edufeed WordPress plugin `nostr-calendar-input` (wp-plugin-amb-nostr):
 *
 *   shared-template.json   unsigned shared 30168 template (SharedTemplate::tags())
 *   community-copy.json    signed community copy (CopyStatus::buildCopy())
 *   response-*.json        signed, NIP-44 encrypted kind 1069 responses to the
 *                          copy, each from a fresh one-time key
 *                          (ResponseCodec::buildEvent / oneTimeSecret)
 *   wp-composed-*.json     the calendar draft the plugin's CalendarComposer
 *                          makes from the same answers, for comparison
 *
 * The community key is THROWAWAY-community-secret.hex beside the fixtures:
 * a test-only key that was never used on a relay. One-time responder keys
 * are generated per run and discarded, as edufeed-forms.md says.
 *
 * Usage (from the edufeed-app root):
 *   WP_CALENDAR_INPUT=/path/to/wp-plugin-amb-nostr/nostr-calendar-input \
 *     nix-shell -p php83 --run 'php scripts/fixtures/generate-calendar-form-fixtures.php'
 *   pnpm exec prettier --write src/lib/__tests__/fixtures/calendar-forms
 *
 * Re-running changes signatures, ids and ciphertexts (fresh one-time keys,
 * random NIP-44 nonces), never the decrypted answers.
 */

declare(strict_types=1);

$plugin = getenv('WP_CALENDAR_INPUT') ?: '';
if ($plugin === '' || !is_file($plugin . '/vendor/autoload.php')) {
    fwrite(STDERR, "Set WP_CALENDAR_INPUT to the nostr-calendar-input plugin directory (with vendor/).\n");
    exit(1);
}
require $plugin . '/vendor/autoload.php';

use Edufeed\NostrCalendarInput\Calendar\CalendarComposer;
use Edufeed\NostrCalendarInput\Calendar\ConceptLabels;
use Edufeed\NostrCalendarInput\Copy\CopyStatus;
use Edufeed\NostrCalendarInput\Copy\SharedTemplate;
use Edufeed\NostrCalendarInput\Form\FormTemplate;
use Edufeed\NostrCalendarInput\Form\ResponseCodec;
use Edufeed\WpNostrShared\NostrPublisher;
use swentel\nostr\Event\Event;

$out = dirname(__DIR__, 2) . '/src/lib/__tests__/fixtures/calendar-forms';
$communitySecret = trim((string) file_get_contents($out . '/THROWAWAY-community-secret.hex'));
if (!preg_match('/^[0-9a-f]{64}$/', $communitySecret)) {
    fwrite(STDERR, "THROWAWAY-community-secret.hex is not a hex secret key.\n");
    exit(1);
}

/** @param array<string,mixed> $data */
function write_fixture(string $path, array $data): void
{
    file_put_contents($path, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n");
}

// Shared template, as bin/shared-template.php prints it.
$sharedEvent = ['kind' => 30168, 'pubkey' => SharedTemplate::PUBKEY, 'content' => '', 'tags' => SharedTemplate::tags()];
$shared = FormTemplate::fromEvent($sharedEvent);
write_fixture($out . '/shared-template.json', $sharedEvent);

// Community copy, signed with the throwaway community key.
$copyUnsigned = CopyStatus::buildCopy($shared);
$copyEvent = new Event();
$copyEvent->setKind($copyUnsigned['kind']);
$copyEvent->setContent($copyUnsigned['content']);
$copyEvent->setTags($copyUnsigned['tags']);
$copySigned = (new NostrPublisher())->sign($copyEvent, $communitySecret);
write_fixture($out . '/community-copy.json', $copySigned);
$copy = FormTemplate::fromEvent($copySigned);

// The plugin's composer with the KIM labels of level_C (offline stand-in
// for the relay lookup the plugin does in production).
$labels = new class () implements ConceptLabels {
    public function labels(string $uri): array
    {
        return $uri === 'https://w3id.org/kim/educationalLevel/level_C'
            ? ['de' => 'Fortbildung', 'en' => 'Advanced training']
            : [];
    }
};
$composer = new CalendarComposer($labels);

$responses = [
    // edufeed-calendar-forms.md "Worked example": the anonymous visitor's answers.
    'worked-example' => [
        'title' => 'OER-Werkstatt',
        'allday' => 'false',
        'start' => '2026-11-20T14:00',
        'end' => '2026-11-20T16:00',
        'mode' => 'https://schema.org/OnlineEventAttendanceMode',
        'level' => ['https://w3id.org/kim/educationalLevel/level_C'],
        'speakers' => ['Jane Doe'],
    ],
    // A multi-day all-day event using the remaining targets.
    'all-day' => [
        'title' => 'OER-Camp',
        'description' => "Zwei Tage **Barcamp**.\n\nMit Abendprogramm.",
        'allday' => 'true',
        'start' => '2026-12-03',
        'end' => '2026-12-04',
        'location' => 'Bibliothek, Raum 2',
        'image' => 'https://example.org/camp.png',
        'hashtags' => ['#oer', 'barcamp'],
        'links' => ['https://example.org/camp', 'https://example.org/anmeldung'],
        'speakers' => ['npub19rtu4896peq0txzre5wd2p7p4yffr9mf73y45recmu4s4vpr30zqn7zrla', 'Jane Doe'],
        'organizers' => ['Max Muster', 'Jane Doe'],
        'registration' => 'true',
        'price' => '12,50',
        'currency' => 'eur',
        'mode' => 'https://schema.org/OfflineEventAttendanceMode',
        'level' => [
            'https://w3id.org/kim/educationalLevel/level_C',
            'https://w3id.org/kim/educationalLevel/level_A',
        ],
    ],
];

foreach ($responses as $name => $values) {
    $oneTime = ResponseCodec::oneTimeSecret();
    write_fixture($out . "/response-{$name}.json", ResponseCodec::buildEvent($copy, $values, $oneTime));
    unset($oneTime);
    write_fixture($out . "/wp-composed-{$name}.json", $composer->compose($copy, $values));
}

echo "Wrote fixtures to {$out}\n";
