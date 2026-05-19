/**
 * Resolve a vocab key (e.g. `'schulfaecher'`, `'educationalLevel'`) into the
 * `{ type, id, vocab: { address, relay } }` field shape that
 * `FormConceptPicker` expects.
 *
 * The input key must match one of the `runtimeConfig.educational.schemeNaddrs`
 * slugs (which mirror the `SCHEME_NADDR_<UPPER_SNAKE>` env var suffixes).
 * Unknown keys, empty slots, or non-naddr strings yield `null` so callers can
 * skip rendering the picker instead of crashing.
 *
 * Pure function aside from reading the runtime config store — network lookups
 * happen later inside `FormConceptPicker` via `useConceptScheme`.
 */

import { nip19 } from 'nostr-tools';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

/**
 * @typedef {Object} VocabFieldVocab
 * @property {string} address - Replaceable coord `kind:pubkey:d`
 * @property {string} relay   - First relay hint from the naddr (may be '')
 */

/**
 * @typedef {Object} VocabField
 * @property {'concept-picker'} type
 * @property {string} id
 * @property {string} label
 * @property {VocabFieldVocab} vocab
 */

/**
 * @param {string} key
 * @returns {VocabField | null}
 */
export function resolveVocabField(key) {
  const schemeNaddrs = /** @type {Record<string, string>} */ (
    runtimeConfig.educational?.schemeNaddrs ?? {}
  );
  const naddr = schemeNaddrs[key];
  if (!naddr) return null;

  try {
    const decoded = /** @type {any} */ (nip19.decode(naddr));
    if (decoded.type !== 'naddr') return null;
    const data =
      /** @type {{kind: number, pubkey: string, identifier: string, relays?: string[]}} */ (
        decoded.data
      );
    return {
      type: 'concept-picker',
      id: key,
      label: key,
      vocab: {
        address: `${data.kind}:${data.pubkey}:${data.identifier}`,
        relay: data.relays?.[0] ?? ''
      }
    };
  } catch {
    return null;
  }
}

/**
 * Decode every entry of `runtimeConfig.educational.schemeNaddrs` into the
 * `{ address, relay }` shape `subStepToFormFields` (and any other map-consuming
 * caller) expects. Slots whose value is empty or fails to decode are dropped
 * silently — mirrors `resolveVocabField`'s tolerance.
 *
 * @returns {Record<string, VocabFieldVocab>}
 */
export function resolveSchemeNaddrsMap() {
  const raw = /** @type {Record<string, string>} */ (runtimeConfig.educational?.schemeNaddrs ?? {});
  /** @type {Record<string, VocabFieldVocab>} */
  const out = {};
  for (const key of Object.keys(raw)) {
    const field = resolveVocabField(key);
    if (field) out[key] = field.vocab;
  }
  return out;
}
