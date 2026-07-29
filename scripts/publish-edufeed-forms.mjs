#!/usr/bin/env node
/**
 * Publish edufeed default form templates (kind 30168).
 *
 * Reads form definitions from `scripts/data/edufeed-forms.json`. Each field
 * may carry a `vocabRef` (the d-tag of a scheme published via publish:vocabs).
 * Scheme naddrs are resolved from env vars of the form
 *   SCHEME_NADDR_<UPPER_SNAKE>
 * where dashes in the d-tag become underscores (e.g. `new-lrt` →
 * `SCHEME_NADDR_NEW_LRT`).
 *
 * Env:
 *   EDUFEED_PUBLISHER_NSEC        hex secret key
 *   EDUFEED_PUBLISH_RELAYS        comma-separated relay URLs
 *   SCHEME_NADDR_<UPPER_SNAKE>    per-vocab naddr (paste from publish:vocabs)
 *
 * Usage:
 *   pnpm run publish:forms
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hexToBytes } from 'nostr-tools/utils';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { RelayPool } from 'applesauce-relay';
// Pure tag building lives in scripts/lib so it's unit-testable without this
// module's side effects (dotenv credential loading, relay pool).
import { req, buildFormTemplate } from './lib/publish-forms-build.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORMS_DATA_PATH = resolve(__dirname, 'data/edufeed-forms.json');

function sign(template, skHex) {
  return finalizeEvent(
    { ...template, created_at: Math.floor(Date.now() / 1000) },
    hexToBytes(skHex)
  );
}

async function publishAll(pool, relays, events) {
  for (const e of events) {
    await Promise.all(
      relays.map((url) =>
        pool
          .relay(url)
          .publish(e)
          .catch((err) => {
            console.warn(`  ! publish to ${url} failed: ${err.message}`);
          })
      )
    );
  }
}

async function main() {
  const skHex = req('EDUFEED_PUBLISHER_NSEC');
  const relays = req('EDUFEED_PUBLISH_RELAYS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const pubkey = getPublicKey(hexToBytes(skHex));
  const pool = new RelayPool();

  const { forms } = JSON.parse(readFileSync(FORMS_DATA_PATH, 'utf8'));

  for (const form of forms) {
    console.log(`\n=== ${form.d} ===`);
    const template = buildFormTemplate(form);
    const signed = sign(template, skHex);

    const naddr = nip19.naddrEncode({
      kind: 30168,
      pubkey,
      identifier: form.d,
      relays: relays.slice(0, 2)
    });
    console.log(`  naddr: ${naddr}`);
    console.log(`  publishing to ${relays.length} relays …`);
    await publishAll(pool, relays, [signed]);
  }

  console.log('\nDone.');
  process.exit(0);
}

// Only publish when executed directly (allows importing buildFormTemplate
// for verification without touching live relays).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
