/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  ADMIN_PERMS,
  MOD_PERMS,
  memberTier,
  presetRoleId,
  ensurePresetRole,
  assignTier,
  removeTier
} from '$lib/concord/roles.js';

const OWNER = 'o'.repeat(64);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const adminRole = {
  role_id: 'radmin',
  name: 'Admin',
  position: 1,
  permissions: ADMIN_PERMS.toString(),
  scope: { kind: 'server' }
};
const modRole = {
  role_id: 'rmod',
  name: 'Moderator',
  position: 2,
  permissions: MOD_PERMS.toString(),
  scope: { kind: 'server' }
};

describe('memberTier', () => {
  it('owner short-circuits', () => {
    expect(memberTier([], new Map(), OWNER, OWNER)).toBe('owner');
  });
  it('classifies admin and moderator by permission bitmask', () => {
    const grants = new Map([
      [A, ['radmin']],
      [B, ['rmod']]
    ]);
    expect(memberTier([adminRole, modRole], grants, OWNER, A)).toBe('admin');
    expect(memberTier([adminRole, modRole], grants, OWNER, B)).toBe('moderator');
  });
  it('admin wins if a member holds both', () => {
    const grants = new Map([[A, ['rmod', 'radmin']]]);
    expect(memberTier([adminRole, modRole], grants, OWNER, A)).toBe('admin');
  });
  it('returns null for roleless / deleted-role members', () => {
    expect(memberTier([adminRole], new Map(), OWNER, A)).toBe(null);
    const del = { ...adminRole, deleted: true };
    expect(memberTier([del], new Map([[A, ['radmin']]]), OWNER, A)).toBe(null);
  });
});

describe('presetRoleId', () => {
  it('matches by bitmask, ignoring channel-scoped/deleted', () => {
    expect(presetRoleId([adminRole, modRole], 'admin')).toBe('radmin');
    expect(presetRoleId([adminRole, modRole], 'moderator')).toBe('rmod');
    expect(presetRoleId([], 'admin')).toBeUndefined();
  });
});

/**
 * @param {{
 *   roles?: Array<{role_id: string, name: string, position: number, permissions: string, scope: {kind: string}, deleted?: boolean}>,
 *   grants?: Map<string, string[]>
 * }} [opts]
 */
function fakeCommunity({ roles = [], grants = new Map() } = {}) {
  return {
    state$: { value: { roles, grants } },
    createRole: vi.fn(
      (
        /** @type {string} */ _name,
        /** @type {number} */ _position,
        /** @type {bigint} */ _perms
      ) => Promise.resolve('rnew')
    ),
    grantRoles: vi.fn((/** @type {string} */ _member, /** @type {string[]} */ _roleIds) =>
      Promise.resolve()
    )
  };
}

describe('ensurePresetRole', () => {
  it('reuses an existing preset role', async () => {
    const c = fakeCommunity({ roles: [adminRole] });
    expect(await ensurePresetRole(c, 'admin')).toBe('radmin');
    expect(c.createRole).not.toHaveBeenCalled();
  });
  it('creates when absent, with the preset name/position/perms', async () => {
    const c = fakeCommunity();
    expect(await ensurePresetRole(c, 'moderator')).toBe('rnew');
    expect(c.createRole).toHaveBeenCalledWith('Moderator', 2, MOD_PERMS);
  });
});

describe('assignTier / removeTier', () => {
  it('assign sets a full grant set that is preset-exclusive but keeps other roles', async () => {
    const c = fakeCommunity({
      roles: [adminRole, modRole],
      grants: new Map([[A, ['rmod', 'rcustom']]])
    });
    await assignTier(c, A, 'admin');
    // dropped rmod (a preset), kept rcustom, added radmin
    const call = c.grantRoles.mock.calls[0];
    expect(call[0]).toBe(A);
    expect([...call[1]].sort()).toEqual(['radmin', 'rcustom'].sort());
  });
  it('remove strips only preset ids', async () => {
    const c = fakeCommunity({
      roles: [adminRole, modRole],
      grants: new Map([[A, ['radmin', 'rcustom']]])
    });
    await removeTier(c, A);
    expect(c.grantRoles).toHaveBeenCalledWith(A, ['rcustom']);
  });
});
