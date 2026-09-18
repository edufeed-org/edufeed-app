// @ts-nocheck
/**
 * Display-name precedence (NIP-24) and the short-npub placeholder.
 *
 * `display_name` is the field clients render; `name` is the handle-style
 * short name and the fallback. We had the precedence inverted in
 * ProfileHeader and used a hardcoded English "Anonymous User" placeholder,
 * which other clients' users read as an actual name.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { getDisplayName } from '$lib/helpers/displayName.js';
import { shortNpub, hexToNpub } from '$lib/helpers/pubkey.js';

const PUBKEY = '7a09d40239cb1ecc4c16868a8cb84a55981ca8a72e282e74e7bf3a3939df7d5a';

describe('shortNpub', () => {
  it('abbreviates the npub form of a hex pubkey', () => {
    const npub = hexToNpub(PUBKEY);
    const short = shortNpub(PUBKEY);
    expect(short).toBe(`${npub.slice(0, 12)}…${npub.slice(-6)}`);
    expect(short.startsWith('npub1')).toBe(true);
  });

  it('returns an empty string for anything that is not a hex pubkey', () => {
    expect(shortNpub('')).toBe('');
    expect(shortNpub(undefined)).toBe('');
    expect(shortNpub('not-a-pubkey')).toBe('');
  });
});

describe('getDisplayName', () => {
  it('prefers display_name over name', () => {
    expect(getDisplayName({ display_name: 'ALPIKA Grundschule', name: 'alpika' }, PUBKEY)).toBe(
      'ALPIKA Grundschule'
    );
  });

  it('falls back to name when display_name is absent or blank', () => {
    expect(getDisplayName({ name: 'alpika' }, PUBKEY)).toBe('alpika');
    expect(getDisplayName({ display_name: '   ', name: 'alpika' }, PUBKEY)).toBe('alpika');
  });

  it('falls back to the short npub instead of a placeholder word', () => {
    expect(getDisplayName({ picture: 'https://example.com/a.png' }, PUBKEY)).toBe(
      shortNpub(PUBKEY)
    );
    expect(getDisplayName(null, PUBKEY)).toBe(shortNpub(PUBKEY));
    expect(getDisplayName(undefined, PUBKEY)).not.toMatch(/anonymous/i);
  });

  it('trims whitespace around a real name', () => {
    expect(getDisplayName({ display_name: '  ALPIKA  ' }, PUBKEY)).toBe('ALPIKA');
  });

  it('returns an empty string when there is neither a name nor a usable pubkey', () => {
    expect(getDisplayName({}, '')).toBe('');
  });
});
