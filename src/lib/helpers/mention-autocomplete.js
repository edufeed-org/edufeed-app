// Pure half of the `@` people autocomplete shared by every composer
// (ComposerInput) and the Concord channel input: detect an in-progress
// `@query` before the caret, splice the pick into the text as a NIP-27
// `nostr:npub…` reference, and list the pubkeys a text mentions. Mirrors
// emoji-autocomplete.js so both autocompletes feel the same. No Svelte or
// store imports — trivially testable.
import { getContentPointers, getPubkeyFromDecodeResult } from 'applesauce-core/helpers';

/**
 * Detect an in-progress `@query` immediately before the caret. The `@` must
 * sit at the text start or after whitespace so emails/handles mid-word never
 * trigger; the query itself contains no whitespace. An empty query (a bare
 * `@`) is a valid, open picker.
 * @param {string} text
 * @param {number} caret cursor position (selectionStart)
 * @returns {{start: number, query: string} | null}
 */
export function detectMentionQuery(text, caret) {
  const upToCaret = text.slice(0, caret);
  const at = upToCaret.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upToCaret[at - 1])) return null;
  const query = upToCaret.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

/**
 * Replace the `@query` span with a NIP-27 `nostr:npub…` reference plus a
 * trailing space. Publish pipelines turn the reference into a `p` tag.
 * @param {string} text
 * @param {number} start index of the `@`
 * @param {number} caret current cursor position (end of the query)
 * @param {string} npub bech32 npub of the selected person
 * @returns {{text: string, caret: number}}
 */
export function applyMention(text, start, caret, npub) {
  const inserted = `nostr:${npub} `;
  const nextText = text.slice(0, start) + inserted + text.slice(caret);
  return { text: nextText, caret: start + inserted.length };
}

/**
 * Hex pubkeys of every `nostr:npub…` / `nostr:nprofile…` in a text, once
 * each, in order of first appearance. Event pointers (note/nevent/naddr)
 * are not mentions of a person and are skipped.
 * @param {string} text
 * @returns {string[]}
 */
export function mentionPubkeysIn(text) {
  if (!text) return [];
  /** @type {string[]} */
  const out = [];
  for (const pointer of getContentPointers(text)) {
    if (pointer.type !== 'npub' && pointer.type !== 'nprofile') continue;
    const pubkey = getPubkeyFromDecodeResult(pointer);
    if (pubkey && !out.includes(pubkey)) out.push(pubkey);
  }
  return out;
}

/**
 * Hex pubkeys from an event's `p` tags, once each — the list a composer
 * hands to publishEvent so the outbox model also writes to the mentioned
 * users' read relays.
 * @param {{ tags: string[][] }} event
 * @returns {string[]}
 */
export function pTagPubkeys(event) {
  /** @type {string[]} */
  const out = [];
  for (const tag of event.tags ?? []) {
    if (tag[0] === 'p' && typeof tag[1] === 'string' && tag[1] && !out.includes(tag[1])) {
      out.push(tag[1]);
    }
  }
  return out;
}
