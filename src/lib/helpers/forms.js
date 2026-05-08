import { nip19 } from 'nostr-tools';
import * as m from '$lib/paraglide/messages';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';

/**
 * Find kind 30000 events that link to a specific form via ['form', formAddress] tag.
 * @param {import('nostr-tools').NostrEvent[]} profileListEvents
 * @param {string} formAddress - e.g. "30168:pubkey:d-tag"
 * @returns {{ sectionName: string, event: import('nostr-tools').NostrEvent }[]}
 */
export function findLinkedProfileLists(profileListEvents, formAddress) {
  return profileListEvents
    .filter((e) => e.tags.some((t) => t[0] === 'form' && t[1] === formAddress))
    .map((e) => ({
      sectionName: e.tags.find((t) => t[0] === 'd')?.[1] || '',
      event: e
    }));
}

/** Kind for form request events (peer-to-peer form sending) */
export const FORM_REQUEST_KIND = 1070;

/**
 * @typedef {Object} FormField
 * @property {string} id
 * @property {string} type - text|textarea|number|email|url|select|checkbox|radio|date|text-array
 * @property {string} label
 * @property {string} [defaultValue]
 * @property {Record<string, any>} [options] - { required, min, max, options, placeholder }
 * @property {{ address: string, relay: string }} [vocab] - kind-39737 ConceptScheme binding
 * @property {string} [output] - 'amb:<property>' or 'ext'. Defaults to 'amb:<id>' at parse time.
 */

/**
 * @typedef {Object} ParsedFormTemplate
 * @property {string} dTag
 * @property {string} name
 * @property {string} description
 * @property {FormField[]} fields
 * @property {boolean} isPublic
 * @property {string} confirmationMessage
 * @property {boolean} autoResponse
 * @property {{ address: string, relay: string }} [forkOf] - parent form this one was forked from
 */

/**
 * Build tags for a form template event (kind 30168).
 * @param {string} dTag
 * @param {FormField[]} fields
 * @param {{ name?: string, description?: string, public?: boolean, confirmationMessage?: string, autoResponse?: boolean, forkOf?: { address: string, relay: string } }} options
 * @returns {string[][]}
 */
export function buildFormTemplateTags(dTag, fields, options = {}) {
  /** @type {string[][]} */
  const tags = [['d', dTag]];

  if (options.name) tags.push(['name', options.name]);
  if (options.description) tags.push(['description', options.description]);
  if (options.forkOf?.address) {
    tags.push(['a', options.forkOf.address, options.forkOf.relay || '', 'forkOf']);
  }

  for (const field of fields) {
    tags.push([
      'field',
      field.id,
      field.type,
      field.label,
      field.defaultValue || '',
      JSON.stringify(field.options || {})
    ]);
    if (field.vocab) {
      tags.push(['field-vocab', field.id, 'a', field.vocab.address, field.vocab.relay]);
    }
    if (field.output) {
      tags.push(['field-output', field.id, field.output]);
    }
  }

  if (options.public) tags.push(['public']);
  if (options.confirmationMessage) tags.push(['confirmation_message', options.confirmationMessage]);
  if (options.autoResponse) tags.push(['auto_response', 'true']);

  return tags;
}

/**
 * Parse a form template event into structured data.
 * @param {{ kind: number, pubkey: string, tags: string[][], content: string, created_at: number }} event
 * @returns {ParsedFormTemplate}
 */
export function parseFormTemplate(event) {
  const tags = event.tags || [];

  const dTag = tags.find((t) => t[0] === 'd')?.[1] || '';
  const name = tags.find((t) => t[0] === 'name')?.[1] || '';
  const description = tags.find((t) => t[0] === 'description')?.[1] || '';
  const isPublic = tags.some((t) => t[0] === 'public');
  const confirmationMessage = tags.find((t) => t[0] === 'confirmation_message')?.[1] || '';
  const autoResponse = tags.find((t) => t[0] === 'auto_response')?.[1] === 'true';

  /** @type {FormField[]} */
  const fields = tags
    .filter((t) => t[0] === 'field' && t.length >= 4)
    .map((t) => {
      let options = {};
      try {
        options = t[5] ? JSON.parse(t[5]) : {};
      } catch {
        options = {};
      }
      return {
        id: t[1],
        type: t[2],
        label: t[3],
        defaultValue: t[4] || '',
        options
      };
    });

  // Attach first field-vocab per field
  for (const field of fields) {
    const vt = tags.find((t) => t[0] === 'field-vocab' && t[1] === field.id && t[2] === 'a');
    if (vt) field.vocab = { address: vt[3], relay: vt[4] || '' };
  }

  // Attach first field-output per field; default to amb:<id>
  for (const field of fields) {
    const ot = tags.find((t) => t[0] === 'field-output' && t[1] === field.id);
    field.output = ot?.[2] || `amb:${field.id}`;
  }

  // Fork provenance: first ["a", "30168:...", relay, "forkOf"] wins
  const forkTag = tags.find((t) => t[0] === 'a' && t[3] === 'forkOf' && t[1]?.startsWith('30168:'));
  const forkOf = forkTag ? { address: forkTag[1], relay: forkTag[2] || '' } : undefined;

  return {
    dTag,
    name,
    description,
    fields,
    isPublic,
    confirmationMessage,
    autoResponse,
    forkOf
  };
}

/**
 * Generate a unique field ID from a label.
 * @param {string} label
 * @param {string[]} existingIds
 * @returns {string}
 */
export function generateFieldId(label, existingIds) {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const isFallback = !base;
  if (!base) base = 'field';

  if (!isFallback) {
    if (!existingIds.includes(base)) return base;
  }

  let suffix = isFallback ? 1 : 2;
  while (existingIds.includes(`${base}-${suffix}`)) {
    suffix++;
  }
  return `${base}-${suffix}`;
}

/**
 * Validate a field value against its constraints.
 * @param {FormField} field
 * @param {string | string[]} value
 * @returns {string | null} Error message or null if valid
 */
export function validateField(field, value) {
  const { options = {} } = field;
  const label = field.label;

  // Required check
  if (options.required) {
    if (field.type === 'checkbox' && value !== 'true') return `${label} is required`;
    if (field.type === 'text-array') {
      const arr = Array.isArray(value) ? value : [];
      if (!arr.some((v) => typeof v === 'string' && v.trim().length > 0)) {
        return `${label} is required`;
      }
    } else if (field.type !== 'checkbox' && !value) {
      return `${label} is required`;
    }
  }

  // Skip further checks if empty and not required
  if (field.type === 'text-array') return null;
  if (!value) return null;
  // After this point, only scalar field types remain; treat value as string.
  const str = /** @type {string} */ (value);

  // Min/max for text types (character length)
  if (
    (field.type === 'text' || field.type === 'textarea') &&
    options.min &&
    str.length < options.min
  ) {
    return `${label} must be at least ${options.min} characters`;
  }
  if (
    (field.type === 'text' || field.type === 'textarea') &&
    options.max &&
    str.length > options.max
  ) {
    return `${label} must be at most ${options.max} characters`;
  }

  // Min/max for number type (numeric value)
  if (field.type === 'number') {
    const num = Number(str);
    if (options.min !== undefined && num < options.min)
      return `${label} must be at least ${options.min}`;
    if (options.max !== undefined && num > options.max)
      return `${label} must be at most ${options.max}`;
  }

  // Email format
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
    return `${label} must be a valid email address`;
  }

  // URL format
  if (field.type === 'url') {
    try {
      new URL(str);
    } catch {
      return `${label} must be a valid URL`;
    }
  }

  return null;
}

/**
 * Build response tags from field values.
 * @param {Record<string, string>} values - field ID to value
 * @returns {string[][]}
 */
export function buildResponseTags(values) {
  return Object.entries(values).map(([id, value]) => ['response', id, value]);
}

/**
 * Parse response tags into a values map.
 * @param {string[][]} tags
 * @returns {Record<string, string>}
 */
export function parseResponseTags(tags) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const tag of tags) {
    if (tag[0] === 'response' && tag.length >= 3) {
      values[tag[1]] = tag[2];
    }
  }
  return values;
}

/**
 * Convert a form coordinate (30168:pubkey:d-tag) to an naddr.
 * @param {string} coordinate
 * @param {string[]} relays
 * @returns {string}
 */
export function formCoordinateToNaddr(coordinate, relays) {
  const parts = coordinate.split(':');
  if (parts.length < 3) throw new Error(`Invalid form coordinate: ${coordinate}`);
  const [kindStr, pubkey, ...identifierParts] = parts;
  return nip19.naddrEncode({
    kind: Number(kindStr),
    pubkey,
    identifier: identifierParts.join(':'),
    relays
  });
}

/**
 * Decode and validate a form naddr string.
 * @param {string} naddrStr
 * @returns {{ pubkey: string, identifier: string, relays: string[], error?: undefined } | { error: string, pubkey?: undefined, identifier?: undefined, relays?: undefined }}
 */
export function decodeFormNaddr(naddrStr) {
  let decoded;
  try {
    decoded = nip19.decode(naddrStr);
  } catch {
    return { error: 'Invalid form address' };
  }

  if (decoded.type !== 'naddr') {
    return { error: 'Invalid form address' };
  }

  const { pubkey, identifier, kind, relays } = decoded.data;
  if (kind !== 30168) {
    return { error: 'Not a form address' };
  }

  return { pubkey, identifier, relays: relays || [] };
}

/** Kind for form template events */
export const FORM_TEMPLATE_KIND = 30168;

/**
 * Returns the default membership form definition using current locale i18n messages.
 * @returns {{ dTag: string, name: string, fields: FormField[] }}
 */
export function getDefaultMembershipForm() {
  return {
    dTag: 'membership',
    name: m.default_form_name(),
    fields: [
      { id: 'name', type: 'text', label: m.default_form_field_name(), options: { required: true } },
      {
        id: 'email',
        type: 'email',
        label: m.default_form_field_email(),
        options: { required: true }
      },
      {
        id: 'motivation',
        type: 'textarea',
        label: m.default_form_field_motivation(),
        options: { required: true }
      }
    ]
  };
}

/**
 * Create and sign a default membership form template event (kind 30168).
 * @param {import('applesauce-signers').ISigner} signer
 * @returns {Promise<import('nostr-tools').NostrEvent>}
 */
export async function createDefaultMembershipForm(signer) {
  const { dTag, name, fields } = getDefaultMembershipForm();
  const tags = buildFormTemplateTags(dTag, fields, { name });
  const factory = createAppEventFactory({ signer });
  const template = await factory.build({ kind: FORM_TEMPLATE_KIND, tags, content: '' });
  return factory.sign(template);
}

/**
 * Build a Nostr filter to find a user's existing response to a form.
 * @param {string} formAddress - e.g. "30168:pubkey:d-tag"
 * @param {string} userPubkey - hex pubkey of the user
 * @returns {{ kinds: number[], authors: string[], '#a': string[] }}
 */
export function buildUserResponseFilter(formAddress, userPubkey) {
  return { kinds: [1069], authors: [userPubkey], '#a': [formAddress] };
}

/**
 * Extract the form template a-tag coordinate from a form request event.
 * @param {{ tags: string[][] }} event
 * @returns {string | undefined}
 */
export function getFormRequestFormAddress(event) {
  return event.tags.find((t) => t[0] === 'a')?.[1];
}

/**
 * Parse the message from decrypted form request content.
 * @param {string} content - Decrypted JSON string
 * @returns {string}
 */
export function parseFormRequestMessage(content) {
  if (!content) return '';
  try {
    const parsed = JSON.parse(content);
    return parsed.message || '';
  } catch {
    return '';
  }
}

/**
 * Convert a form event to an naddr string.
 * @param {{ kind: number, pubkey: string, tags: string[][], content: string, created_at: number }} event
 * @param {string[]} relays
 * @returns {string}
 */
export function formEventToNaddr(event, relays) {
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1] || '';
  return nip19.naddrEncode({
    kind: event.kind,
    pubkey: event.pubkey,
    identifier: dTag,
    relays
  });
}
