/** @vitest-environment node */
// src/lib/__tests__/root-roster.test.js
import { describe, it, expect } from 'vitest';
import { rosterView } from '$lib/groups/root-roster.js';
import { channelKey } from '$lib/groups/community-pointer.js';

const RELAY = 'wss://groups.example.com';
const POINTER = { id: 'root1', relay: RELAY };
const KEY = /** @type {string} */ (channelKey(POINTER));
const ADMIN = 'a'.repeat(64);
const MEMBER = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);

describe('rosterView', () => {
  it('unions 39002 members with 39001 admins (admins are members per NIP-29)', () => {
    const view = rosterView(
      POINTER,
      { [KEY]: new Set([MEMBER]) },
      { [KEY]: [{ pubkey: ADMIN, roles: ['lehrkraft'] }] }
    );
    expect(view.isMember(MEMBER)).toBe(true);
    expect(view.isMember(ADMIN)).toBe(true);
    expect(view.isMember(STRANGER)).toBe(false);
    expect(view.members).toEqual(new Set([MEMBER, ADMIN]));
    expect(view.isLoading).toBe(false);
  });

  it('rolesOf reads roles from 39001; non-admins have no roles', () => {
    const view = rosterView(
      POINTER,
      { [KEY]: new Set([MEMBER]) },
      {
        [KEY]: [{ pubkey: ADMIN, roles: ['lehrkraft', 'mod'] }]
      }
    );
    expect(view.rolesOf(ADMIN)).toEqual(['lehrkraft', 'mod']);
    expect(view.rolesOf(MEMBER)).toEqual([]);
  });

  it('isLoading while neither roster event has arrived for the key', () => {
    const loading = rosterView(POINTER, {}, {});
    expect(loading.isLoading).toBe(true);
    expect(loading.isMember(MEMBER)).toBe(false);
    // a 39001 alone ends loading (some relays withhold 39002 — NIP-29 says
    // clients must not assume it exists)
    expect(rosterView(POINTER, {}, { [KEY]: [{ pubkey: ADMIN, roles: [] }] }).isLoading).toBe(
      false
    );
  });

  it('fetchedKeys ends loading even with no roster stored (eventStore said nothing)', () => {
    // The store holds no 39002/39001 for this key, but the relay has answered
    // (key is in fetchedKeys) — so it is a genuinely empty roster, not loading.
    const fetched = new Set([KEY]);
    const view = rosterView(POINTER, {}, {}, fetched);
    expect(view.isLoading).toBe(false);
    expect(view.members.size).toBe(0);
    // Not yet fetched → still loading.
    expect(rosterView(POINTER, {}, {}, new Set()).isLoading).toBe(true);
  });

  it('null pointer → empty, not loading', () => {
    const view = rosterView(null, {}, {});
    expect(view.isLoading).toBe(false);
    expect(view.members.size).toBe(0);
    expect(view.admins).toEqual([]);
  });
});
