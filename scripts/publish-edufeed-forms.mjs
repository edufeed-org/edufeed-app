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

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORMS_DATA_PATH = resolve(__dirname, 'data/edufeed-forms.json');

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function sign(template, skHex) {
  return finalizeEvent(
    { ...template, created_at: Math.floor(Date.now() / 1000) },
    hexToBytes(skHex)
  );
}

function vocabEnvName(d) {
  return `SCHEME_NADDR_${d.toUpperCase().replace(/-/g, '_')}`;
}

function naddrToCoord(naddr) {
  const { type, data } = nip19.decode(naddr);
  if (type !== 'naddr') throw new Error('expected naddr');
  return {
    address: `${data.kind}:${data.pubkey}:${data.identifier}`,
    relay: (data.relays || [])[0] || ''
  };
}

/**
 * Emit tags for a single form field, including optional vocab + output tags.
 */
function emitFieldTags(field, vocabCoord) {
  const options = {};
  if (field.required) options.required = true;
  if (field.multiple) options.multiple = true;
  const tags = [
    ['field', field.id, field.type, field.label, field.defaultValue || '', JSON.stringify(options)]
  ];
  if (vocabCoord) tags.push(['field-vocab', field.id, 'a', vocabCoord.address, vocabCoord.relay]);
  if (field.output) tags.push(['field-output', field.id, field.output]);
  return tags;
}

/**
 * Build a kind-30168 form template from a form definition, resolving
 * each field's vocabRef via env.
 */
function buildFormTemplate(form) {
  /** @type {string[][]} */
  const tags = [
    ['d', form.d],
    ['name', form.name]
  ];
  if (form.description) tags.push(['description', form.description]);

  for (const field of form.fields) {
    const vocabCoord = field.vocabRef ? naddrToCoord(req(vocabEnvName(field.vocabRef))) : undefined;
    for (const t of emitFieldTags(field, vocabCoord)) tags.push(t);
  }

  return { kind: 30168, tags, content: '' };
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
