/** @vitest-environment node */
/**
 * Pure half of the `@` people autocomplete shared by every composer:
 * trigger detection before the caret, splicing the pick in as a NIP-27
 * `nostr:npub…` reference, and listing the pubkeys a text / an event mentions.
 */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  detectMentionQuery,
  applyMention,
  mentionPubkeysIn,
  pTagPubkeys
} from '$lib/helpers/mention-autocomplete.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const npubA = nip19.npubEncode(A);
const nprofileB = nip19.nprofileEncode({ pubkey: B, relays: ['wss://r.example'] });

describe('detectMentionQuery', () => {
  it('finds @query at the caret', () => {
    expect(detectMentionQuery('hello @ali', 10)).toEqual({ start: 6, query: 'ali' });
  });
  it('opens on a bare @ (empty query)', () => {
    expect(detectMentionQuery('hey @', 5)).toEqual({ start: 4, query: '' });
  });
  it('requires @ at start or after whitespace (emails do not trigger)', () => {
    expect(detectMentionQuery('mail me a@b', 11)).toBeNull();
    expect(detectMentionQuery('@a', 2)).toEqual({ start: 0, query: 'a' });
  });
  it('closes after whitespace', () => {
    expect(detectMentionQuery('hey @ali how', 12)).toBeNull();
  });
});

describe('applyMention', () => {
  it('replaces @query with nostr:npub + trailing space', () => {
    const r = applyMention('hey @ali how', 4, 8, 'npub1xyz');
    expect(r.text).toBe('hey nostr:npub1xyz  how');
    expect(r.caret).toBe(4 + 'nostr:npub1xyz '.length);
  });
});

describe('mentionPubkeysIn', () => {
  it('returns hex pubkeys for npub and nprofile references, once each', () => {
    const text = `hi nostr:${npubA} and nostr:${nprofileB} again nostr:${npubA}`;
    expect(mentionPubkeysIn(text)).toEqual([A, B]);
  });
  it('ignores invalid and non-profile pointers', () => {
    const note = nip19.noteEncode('c'.repeat(64));
    expect(mentionPubkeysIn(`nostr:npub1garbage nostr:${note}`)).toEqual([]);
  });
  it('returns [] for empty text', () => {
    expect(mentionPubkeysIn('')).toEqual([]);
  });
});

describe('pTagPubkeys', () => {
  it('reads p tags once each, ignoring malformed ones', () => {
    const event = { tags: [['p', A], ['p', B, 'wss://x'], ['p', A], ['p'], ['e', 'x']] };
    expect(pTagPubkeys(event)).toEqual([A, B]);
  });
});
