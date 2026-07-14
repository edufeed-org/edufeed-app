/**
 * Note reference helper tests (issue #36)
 *
 * parseReferenceToken: validates pasted NIP-19 identifiers / nostr: URIs /
 * njump-style URLs into reference tokens for the note composer.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  parseReferenceToken,
  buildReferenceUri,
  insertReferenceIntoContent
} from '$lib/helpers/noteReferences.js';

const EVENT_ID = 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8';
const PUBKEY = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

const nevent = nip19.neventEncode({ id: EVENT_ID, relays: [], author: PUBKEY });
const naddr = nip19.naddrEncode({ kind: 30142, pubkey: PUBKEY, identifier: 'res-1', relays: [] });
const note = nip19.noteEncode(EVENT_ID);
const npub = nip19.npubEncode(PUBKEY);

describe('parseReferenceToken', () => {
  it('accepts a bare nevent', () => {
    expect(parseReferenceToken(nevent)).toEqual({ type: 'nevent', encoded: nevent });
  });

  it('accepts a bare naddr', () => {
    expect(parseReferenceToken(naddr)).toEqual({ type: 'naddr', encoded: naddr });
  });

  it('accepts a bare note1 id', () => {
    expect(parseReferenceToken(note)).toEqual({ type: 'note', encoded: note });
  });

  it('accepts an npub', () => {
    expect(parseReferenceToken(npub)).toEqual({ type: 'npub', encoded: npub });
  });

  it('strips a nostr: prefix', () => {
    expect(parseReferenceToken(`nostr:${nevent}`)).toEqual({ type: 'nevent', encoded: nevent });
  });

  it('extracts the identifier from a wrapping URL', () => {
    expect(parseReferenceToken(`https://njump.me/${naddr}`)).toEqual({
      type: 'naddr',
      encoded: naddr
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseReferenceToken(`  ${note}  `)).toEqual({ type: 'note', encoded: note });
  });

  it('rejects an nsec', () => {
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(7));
    expect(parseReferenceToken(nsec)).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(parseReferenceToken('not-an-identifier')).toBeNull();
    expect(parseReferenceToken('nevent1corrupted')).toBeNull();
  });

  it('rejects empty and non-string input', () => {
    expect(parseReferenceToken('')).toBeNull();
    expect(parseReferenceToken('   ')).toBeNull();
    expect(parseReferenceToken(/** @type {any} */ (null))).toBeNull();
    expect(parseReferenceToken(/** @type {any} */ (undefined))).toBeNull();
  });
});

describe('buildReferenceUri', () => {
  it('prefixes the encoded identifier with nostr:', () => {
    expect(buildReferenceUri({ encoded: nevent })).toBe(`nostr:${nevent}`);
  });
});

describe('insertReferenceIntoContent', () => {
  const uri = `nostr:${nevent}`;

  it('returns the uri alone for empty content', () => {
    expect(insertReferenceIntoContent('', uri)).toBe(uri);
    expect(insertReferenceIntoContent('   ', uri)).toBe(uri);
  });

  it('appends on a new paragraph when content has text', () => {
    expect(insertReferenceIntoContent('Hello world', uri)).toBe(`Hello world\n\n${uri}`);
  });

  it('does not add extra blank lines when content ends with a newline', () => {
    expect(insertReferenceIntoContent('Hello world\n', uri)).toBe(`Hello world\n${uri}`);
  });
});
