import { nip19 } from 'nostr-tools';
import * as m from '$lib/paraglide/messages';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';

export {
  FORM_TEMPLATE_KIND,
  FORM_RESPONSE_KIND,
  buildFormTemplateTags,
  parseFormTemplate,
  generateFieldId,
  generateOptionId
} from './forms/format.js';
export { nip44EncryptWith, nip44DecryptWith, signerHasNip44 } from './forms/crypto.js';
import { FORM_TEMPLATE_KIND, FORM_RESPONSE_KIND, buildFormTemplateTags } from './forms/format.js';

/** @typedef {import('./forms/format.js').FormField} FormField */
/** @typedef {import('./forms/format.js').FormFieldOption} FormFieldOption */

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
    } else if (field.vocab) {
      const arr = Array.isArray(value) ? value : [];
      if (arr.length === 0) return `${label} is required`;
    } else if (field.type !== 'checkbox' && !value) {
      return `${label} is required`;
    }
  }

  // Skip further checks if empty and not required
  if (field.type === 'text-array') return null;
  if (field.vocab) return null;
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
  return Object.entries(values).map(([id, value]) => ['response', id, String(value ?? ''), '{}']);
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
 * Returns the edufeed.org membership application form definition.
 * Separate from getDefaultMembershipForm() because that one is used by
 * per-community join templates (EditCommunityModal/CreateCommunityModal).
 * @returns {{ dTag: string, name: string, fields: FormField[] }}
 */
export function getEdufeedMembershipForm() {
  return {
    dTag: 'edufeed-membership',
    name: m.edufeed_membership_form_name(),
    fields: [
      {
        id: 'wished_handle',
        type: 'text',
        label: m.edufeed_membership_field_wished_handle_label(),
        options: {
          required: true,
          min: 2,
          max: 30,
          pattern: '^[a-z0-9._-]+$',
          placeholder: m.edufeed_membership_field_wished_handle_placeholder()
        }
      },
      {
        id: 'full_name',
        type: 'text',
        label: m.edufeed_membership_field_full_name_label(),
        options: { required: true }
      },
      {
        id: 'affiliation',
        type: 'text',
        label: m.edufeed_membership_field_affiliation_label(),
        options: {}
      },
      {
        id: 'role',
        type: 'text',
        label: m.edufeed_membership_field_role_label(),
        options: { placeholder: m.edufeed_membership_field_role_placeholder() }
      },
      {
        id: 'motivation',
        type: 'textarea',
        label: m.edufeed_membership_field_motivation_label(),
        options: { required: true }
      }
    ]
  };
}

/**
 * Create and sign the edufeed.org membership form template event (kind 30168).
 * Published once by admin via scripts/publish-membership-form.js.
 * @param {import('applesauce-signers').ISigner} signer
 * @returns {Promise<import('nostr-tools').NostrEvent>}
 */
export async function createEdufeedMembershipForm(signer) {
  const { dTag, name, fields } = getEdufeedMembershipForm();
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
  return { kinds: [FORM_RESPONSE_KIND], authors: [userPubkey], '#a': [formAddress] };
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
