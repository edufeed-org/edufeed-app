/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { memberSections } from '$lib/concord/roster.js';

const OWNER = 'owner'.padEnd(64, '0');
const ADMIN = 'admin'.padEnd(64, '0');
const MOD = 'mod'.padEnd(64, '0');
const PLAIN_A = 'plainA'.padEnd(64, '0');
const PLAIN_B = 'plainB'.padEnd(64, '0');

const ROLE_ADMIN = { role_id: 'r-admin', name: 'Admin', position: 1 };
const ROLE_MOD = { role_id: 'r-mod', name: 'Moderator', position: 2 };
const ROLE_DELETED = { role_id: 'r-deleted', name: 'Retired', position: 1, deleted: true };

describe('memberSections', () => {
  it('puts the owner first, isOwner true, roleName null, even without a grant entry', () => {
    const result = memberSections({
      members: new Set([OWNER, PLAIN_A]),
      roles: [],
      grants: new Map(),
      owner: OWNER
    });
    expect(result.leaders).toEqual([{ pubkey: OWNER, roleName: null, isOwner: true }]);
    expect(result.members).toEqual([PLAIN_A]);
  });

  it('orders role-holders by highest authority first (lowest position number)', () => {
    const result = memberSections({
      members: new Set([OWNER, MOD, ADMIN]),
      roles: [ROLE_ADMIN, ROLE_MOD],
      grants: new Map([
        [ADMIN, ['r-admin']],
        [MOD, ['r-mod']]
      ]),
      owner: OWNER
    });
    expect(result.leaders.map((l) => l.pubkey)).toEqual([OWNER, ADMIN, MOD]);
    expect(result.leaders.map((l) => l.roleName)).toEqual([null, 'Admin', 'Moderator']);
  });

  it('a member holding several roles is ranked by their most authoritative (lowest position) role', () => {
    const result = memberSections({
      members: new Set([ADMIN]),
      roles: [ROLE_ADMIN, ROLE_MOD],
      grants: new Map([[ADMIN, ['r-mod', 'r-admin']]]),
      owner: OWNER
    });
    expect(result.leaders).toEqual([{ pubkey: ADMIN, roleName: 'Admin', isOwner: false }]);
  });

  it('a deleted role confers no rank — the member falls through to plain members', () => {
    const result = memberSections({
      members: new Set([ADMIN]),
      roles: [ROLE_DELETED],
      grants: new Map([[ADMIN, ['r-deleted']]]),
      owner: OWNER
    });
    expect(result.leaders).toEqual([]);
    expect(result.members).toEqual([ADMIN]);
  });

  it('a grant referencing an unknown/stale role_id is treated as no role', () => {
    const result = memberSections({
      members: new Set([ADMIN]),
      roles: [ROLE_ADMIN],
      grants: new Map([[ADMIN, ['r-nonexistent']]]),
      owner: OWNER
    });
    expect(result.leaders).toEqual([]);
    expect(result.members).toEqual([ADMIN]);
  });

  it('members with no roles/grants land in the plain list, in encounter order', () => {
    const result = memberSections({
      members: new Set([PLAIN_A, PLAIN_B]),
      roles: [],
      grants: new Map(),
      owner: OWNER
    });
    expect(result.leaders).toEqual([]);
    expect(result.members).toEqual([PLAIN_A, PLAIN_B]);
  });

  it('owner not present in the member list is not injected', () => {
    const result = memberSections({
      members: new Set([PLAIN_A]),
      roles: [],
      grants: new Map(),
      owner: OWNER
    });
    expect(result.leaders).toEqual([]);
    expect(result.members).toEqual([PLAIN_A]);
  });

  it('dedupes a member list passed as an array', () => {
    const result = memberSections({
      members: [PLAIN_A, PLAIN_A, PLAIN_B],
      roles: [],
      grants: new Map(),
      owner: OWNER
    });
    expect(result.members).toEqual([PLAIN_A, PLAIN_B]);
  });

  it('grants passed as something other than a Map is treated as empty (defensive)', () => {
    const result = memberSections({
      members: new Set([ADMIN]),
      roles: [ROLE_ADMIN],
      grants: /** @type {any} */ ({ [ADMIN]: ['r-admin'] }),
      owner: OWNER
    });
    expect(result.leaders).toEqual([]);
    expect(result.members).toEqual([ADMIN]);
  });

  it('handles fully empty/missing input gracefully', () => {
    expect(
      memberSections({ members: undefined, roles: undefined, grants: undefined, owner: undefined })
    ).toEqual({
      leaders: [],
      members: []
    });
    expect(memberSections({ members: [], roles: [], grants: new Map(), owner: '' })).toEqual({
      leaders: [],
      members: []
    });
  });
});
