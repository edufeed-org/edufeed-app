/** @vitest-environment node */
// src/lib/__tests__/roster-access.test.js
import { describe, it, expect } from 'vitest';
import { sectionAllowedAuthors, canPublishSection } from '$lib/groups/roster-access.js';
import { rosterView } from '$lib/groups/root-roster.js';
import { channelKey } from '$lib/groups/community-pointer.js';

const RELAY = 'wss://groups.example.com';
const POINTER = { id: 'root1', relay: RELAY };
const KEY = channelKey(POINTER);
const OWNER = 'f'.repeat(64);
const TEACHER = 'a'.repeat(64);
const MEMBER = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);

const roster = rosterView(
  POINTER,
  { [KEY]: new Set([MEMBER, TEACHER]) },
  { [KEY]: [{ pubkey: TEACHER, roles: ['lehrkraft'] }] }
);
const loadingRoster = rosterView(POINTER, {}, {});
const section = (access) => ({ name: 'Learning', access, profileList: null });

describe('sectionAllowedAuthors', () => {
  it('tier all → null (open, no filtering)', () => {
    expect(sectionAllowedAuthors(section({ tier: 'all' }), roster, OWNER)).toBeNull();
    expect(sectionAllowedAuthors(section(undefined), roster, OWNER)).toBeNull();
  });
  it('tier members → roster members plus owner', () => {
    const allowed = sectionAllowedAuthors(section({ tier: 'members' }), roster, OWNER);
    expect(allowed).toEqual(expect.arrayContaining([OWNER, MEMBER, TEACHER]));
    expect(allowed).not.toContain(STRANGER);
  });
  it('tier role → only role holders plus owner', () => {
    const allowed = sectionAllowedAuthors(
      section({ tier: 'role', role: 'lehrkraft' }),
      roster,
      OWNER
    );
    expect(allowed).toEqual(expect.arrayContaining([OWNER, TEACHER]));
    expect(allowed).not.toContain(MEMBER);
  });
});

describe('canPublishSection', () => {
  const args = (pubkey, r = roster) => ({ pubkey, ownerPubkey: OWNER, roster: r });
  it('owner always may publish; anonymous never', () => {
    expect(canPublishSection(section({ tier: 'role', role: 'x' }), args(OWNER))).toBe(true);
    expect(canPublishSection(section({ tier: 'all' }), args(undefined))).toBe(false);
  });
  it('tier all → any signed-in user', () => {
    expect(canPublishSection(section({ tier: 'all' }), args(STRANGER))).toBe(true);
  });
  it('tier members / role check the roster', () => {
    expect(canPublishSection(section({ tier: 'members' }), args(MEMBER))).toBe(true);
    expect(canPublishSection(section({ tier: 'members' }), args(STRANGER))).toBe(false);
    expect(canPublishSection(section({ tier: 'role', role: 'lehrkraft' }), args(TEACHER))).toBe(
      true
    );
    expect(canPublishSection(section({ tier: 'role', role: 'lehrkraft' }), args(MEMBER))).toBe(
      false
    );
  });
  it('while the roster is loading, non-owners are denied (conservative, like profile lists)', () => {
    expect(canPublishSection(section({ tier: 'members' }), args(MEMBER, loadingRoster))).toBe(
      false
    );
    expect(canPublishSection(section({ tier: 'members' }), args(OWNER, loadingRoster))).toBe(true);
  });
});
