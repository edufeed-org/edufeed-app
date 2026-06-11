/**
 * Unit tests for the normalizePubkey helper.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { normalizePubkey } from '$lib/helpers/pubkey.js';

const VALID_HEX = 'a'.repeat(64);
const VALID_NPUB = nip19.npubEncode(VALID_HEX);

describe('normalizePubkey', () => {
  it('returns lowercase hex unchanged', () => {
    expect(normalizePubkey(VALID_HEX)).toBe(VALID_HEX);
  });

  it('lowercases mixed-case hex', () => {
    const mixed = 'AbCdEf' + 'a'.repeat(58);
    expect(normalizePubkey(mixed)).toBe(mixed.toLowerCase());
  });

  it('decodes a valid npub to hex', () => {
    expect(normalizePubkey(VALID_NPUB)).toBe(VALID_HEX);
  });

  it('trims surrounding whitespace', () => {
    expect(normalizePubkey(`   ${VALID_NPUB}   `)).toBe(VALID_HEX);
    expect(normalizePubkey(`\t${VALID_HEX}\n`)).toBe(VALID_HEX);
  });

  it('returns null for empty / non-string input', () => {
    expect(normalizePubkey('')).toBeNull();
    expect(normalizePubkey('   ')).toBeNull();
    expect(normalizePubkey(null)).toBeNull();
    expect(normalizePubkey(undefined)).toBeNull();
    expect(normalizePubkey(42)).toBeNull();
  });

  it('returns null for malformed hex (wrong length)', () => {
    expect(normalizePubkey('a'.repeat(63))).toBeNull();
    expect(normalizePubkey('a'.repeat(65))).toBeNull();
  });

  it('returns null for hex with non-hex characters', () => {
    expect(normalizePubkey('z'.repeat(64))).toBeNull();
  });

  it('returns null for invalid npub', () => {
    expect(normalizePubkey('npub1invalid')).toBeNull();
  });

  it('returns null for unrelated NIP-19 prefixes (e.g. nsec, note)', () => {
    const note = nip19.noteEncode(VALID_HEX);
    expect(normalizePubkey(note)).toBeNull();
  });
});
