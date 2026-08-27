#!/usr/bin/env node
/**
 * Publish a webxdc app's kind-1063 event so it can be curated via
 * `WEBXDC_APPS` (see .env.example and CLAUDE.md's Interactive Resources
 * section). The event is the same dual-purpose NIP-94 file metadata + NIP-DC
 * discovery shape the resource form's `publishLicenseAttestation` emits for
 * uploaded webxdc packages — this script is the equivalent one-off tool for
 * curating an app that isn't going through that form.
 *
 * Env:
 *   EDUFEED_PUBLISHER_NSEC    hex secret key
 *   EDUFEED_PUBLISH_RELAYS    comma-separated relay URLs
 *   AMB_RELAYS                comma-separated educational relay URLs —
 *                             unioned with EDUFEED_PUBLISH_RELAYS, since
 *                             webxdc 1063s are looked up on the educational
 *                             relays (getEducationalRelays / getAllLookupRelays)
 *
 * Usage:
 *   node scripts/publish-webxdc-app.mjs --url <blossom-url> --name <name> \
 *     [--icon <url>] [--license <url>] [--credit <text>] [--dry-run]
 *
 * The sha256 (`x` tag) is parsed from the URL's path — the last 64-hex-char
 * run, the same convention as applesauce-common's getSha256FromURL — so
 * --url must be a content-addressed Blossom URL.
 *
 * --dry-run prints the unsigned event template and exits without touching
 * any relay; use it to check the tags before publishing for real.
 */
import 'dotenv/config';
import { hexToBytes } from 'nostr-tools/utils';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { RelayPool } from 'applesauce-relay';
import { getSha256FromURL } from 'applesauce-common/helpers';

const WEBXDC_MIME = 'application/x-webxdc';

/** @param {string[]} argv */
function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--url':
        out.url = argv[++i];
        break;
      case '--name':
        out.name = argv[++i];
        break;
      case '--icon':
        out.icon = argv[++i];
        break;
      case '--license':
        out.license = argv[++i];
        break;
      case '--credit':
        out.credit = argv[++i];
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function usageAndExit() {
  console.error(
    'Usage: node scripts/publish-webxdc-app.mjs --url <blossom-url> --name <name> ' +
      '[--icon <url>] [--license <url>] [--credit <text>] [--dry-run]'
  );
  process.exit(1);
}

/**
 * Build the unsigned kind-1063 template. Pure function: no I/O, no signing.
 * @param {{url: string, name: string, sha256: string, icon?: string, license?: string, credit?: string}} input
 */
function buildTemplate({ url, name, sha256, icon, license, credit }) {
  /** @type {string[][]} */
  const tags = [
    ['url', url],
    ['x', sha256],
    ['m', WEBXDC_MIME],
    ['alt', `Webxdc app: ${name}`]
  ];
  if (icon) tags.push(['image', icon]);
  if (license) tags.push(['license', license]);
  if (credit) tags.push(['credit', credit]);
  return { kind: 1063, content: '', created_at: Math.floor(Date.now() / 1000), tags };
}

/** @param {string | undefined} value */
function parseRelayList(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args.name) usageAndExit();

  const sha256 = getSha256FromURL(args.url);
  if (!sha256) {
    throw new Error(
      `Could not parse a 64-hex sha256 from --url "${args.url}" — expected a content-addressed Blossom URL`
    );
  }

  const template = buildTemplate({ ...args, sha256 });

  if (args.dryRun) {
    console.log(JSON.stringify(template, null, 2));
    return;
  }

  const skHex = requireEnv('EDUFEED_PUBLISHER_NSEC');
  const publishRelays = parseRelayList(requireEnv('EDUFEED_PUBLISH_RELAYS'));
  const educationalRelays = parseRelayList(process.env.AMB_RELAYS);
  const relays = [...new Set([...publishRelays, ...educationalRelays])];
  if (relays.length === 0)
    throw new Error('No relays configured (EDUFEED_PUBLISH_RELAYS/AMB_RELAYS)');

  const sk = hexToBytes(skHex);
  const pubkey = getPublicKey(sk);
  const signed = finalizeEvent(template, sk);

  const pool = new RelayPool();
  console.log(`Publishing kind-1063 "${args.name}" (x=${sha256}) to ${relays.length} relays …`);
  const results = await Promise.allSettled(relays.map((url) => pool.relay(url).publish(signed)));

  let okCount = 0;
  results.forEach((result, i) => {
    const url = relays[i];
    if (result.status === 'fulfilled' && result.value?.ok !== false) {
      okCount++;
    } else {
      const reason =
        result.status === 'rejected'
          ? result.reason?.message || result.reason
          : result.value?.message || 'rejected';
      console.warn(`  ! ${url}: ${reason}`);
    }
  });

  const nevent = nip19.neventEncode({
    id: signed.id,
    author: pubkey,
    kind: 1063,
    relays: relays.slice(0, 2)
  });

  console.log(`\nid:     ${signed.id}`);
  console.log(`nevent: ${nevent}`);

  if (okCount === 0) {
    console.error('\nFailed to publish to any relay.');
    process.exit(1);
  }
  console.log(`\nDone (${okCount}/${relays.length} relays acked).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
