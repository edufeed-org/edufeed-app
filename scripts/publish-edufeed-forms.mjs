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
import {
  FORM_TEMPLATE_KIND,
  buildFormTemplateTags
} from '../src/lib/helpers/forms/format.js';

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
 * Map a JSON field definition (flat required/min/max/… keys) to the FormField
 * shape expected by buildFormTemplateTags (constraints nested under options).
 */
function toFormField(field, vocabCoord) {
  const options = {};
  if (field.required) options.required = true;
  if (field.multiple) options.multiple = true;
  if (field.min !== undefined) options.min = field.min;
  if (field.max !== undefined) options.max = field.max;
  if (field.pattern) options.pattern = field.pattern;
  if (field.placeholder) options.placeholder = field.placeholder;
  const formField = {
    id: field.id,
    type: field.type,
    label: field.label,
    defaultValue: field.defaultValue || '',
    options
  };
  if (vocabCoord) formField.vocab = vocabCoord;
  if (field.output) formField.output = field.output;
  return formField;
}

/**
 * Build a kind-30168 form template from a form definition, resolving each
 * field's vocabRef via env. Tag encoding (NIP-101 settings tag, field tags,
 * field-vocab/field-output extensions) comes from the shared app builder.
 */
export function buildFormTemplate(form) {
  const fields = form.fields.map((field) => {
    const vocabCoord = field.vocabRef ? naddrToCoord(req(vocabEnvName(field.vocabRef))) : undefined;
    return toFormField(field, vocabCoord);
  });
  const tags = buildFormTemplateTags(form.d, fields, {
    name: form.name,
    description: form.description
  });
  return { kind: FORM_TEMPLATE_KIND, tags, content: '' };
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
