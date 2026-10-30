/** @vitest-environment node */
/**
 * Pure helpers behind the people search's "members" group: reading a NIP-05
 * directory (the full `/.well-known/nostr.json`) and putting the
 * deployment's verified members ahead of everyone else.
 */
import { describe, it, expect } from 'vitest';
import { parseDirectoryMembers, membersFirst } from '$lib/helpers/member-directory.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

describe('parseDirectoryMembers', () => {
  it('returns each valid pubkey of the names map once, lowercased', () => {
    const json = { names: { anna: A, anna2: A, ben: B.toUpperCase(), bad: 'nope', num: 42 } };
    expect(parseDirectoryMembers(json)).toEqual([A, B]);
  });

  it('is empty for anything that is not a directory', () => {
    expect(parseDirectoryMembers(null)).toEqual([]);
    expect(parseDirectoryMembers({})).toEqual([]);
    expect(parseDirectoryMembers({ names: 'x' })).toEqual([]);
  });
});

describe('membersFirst', () => {
  /** @param {string} pubkey */
  const row = (pubkey) => ({ pubkey });

  it('splits a ranked list into members and others, keeping each order', () => {
    const { members, others } = membersFirst([row(A), row(B), row(C)], new Set([C, A]));
    expect(members.map((r) => r.pubkey)).toEqual([A, C]);
    expect(others.map((r) => r.pubkey)).toEqual([B]);
  });

  it('puts everyone in others without a directory', () => {
    const { members, others } = membersFirst([row(A)], new Set());
    expect(members).toEqual([]);
    expect(others.map((r) => r.pubkey)).toEqual([A]);
  });
});
