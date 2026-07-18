/**
 * Pure tag-building logic for publish-edufeed-forms.mjs, extracted so it can
 * be unit-tested (scripts/lib/__tests__/) without importing the publish
 * script itself — whose top level loads dotenv (reading credentials from
 * .env into process.env) and the relay pool.
 *
 * Tag encoding comes from the shared app builder, so the script and the app
 * always emit the same NIP-101 format.
 */
import { nip19 } from 'nostr-tools';
import { FORM_TEMPLATE_KIND, buildFormTemplateTags } from '../../src/lib/helpers/forms/format.js';

/** Read a required env var or throw. */
export function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** Env var name a vocab d-tag resolves through (e.g. `new-lrt` → SCHEME_NADDR_NEW_LRT). */
export function vocabEnvName(d) {
  return `SCHEME_NADDR_${d.toUpperCase().replace(/-/g, '_')}`;
}

/** Decode an naddr into a { address, relay } scheme coordinate. */
export function naddrToCoord(naddr) {
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
 * Assumes select/radio fields always carry a vocabRef — the JSON schema has
 * no inline option lists yet, so the builder's inline-`option` branch is
 * never hit by this data.
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
