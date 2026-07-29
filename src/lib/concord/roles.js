// Concord role presets + tier logic (CORD-04). Two preset tiers only — Admin
// (all perms) and Moderator (kick/ban/messages/invite). The owner is implicit
// (material.owner) and outranks everyone.
//
// The CORD-04 §3 permission bits are FROZEN (applesauce-concord types.js PERM);
// mirrored here as local BigInts so classification + preset-building stay
// synchronous and SSR-clean (no applesauce-concord import). Guarded by the
// exact-pin + the package's vitest canary — keep in sync if the frozen set changes.
const PERM = {
  MANAGE_ROLES: 1n << 0n,
  MANAGE_CHANNELS: 1n << 1n,
  MANAGE_METADATA: 1n << 2n,
  KICK: 1n << 3n,
  BAN: 1n << 4n,
  MANAGE_MESSAGES: 1n << 5n,
  CREATE_INVITE: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 8n,
  MENTION_EVERYONE: 1n << 9n
};

export const ADMIN_PERMS =
  PERM.MANAGE_ROLES |
  PERM.MANAGE_CHANNELS |
  PERM.MANAGE_METADATA |
  PERM.KICK |
  PERM.BAN |
  PERM.MANAGE_MESSAGES |
  PERM.CREATE_INVITE |
  PERM.VIEW_AUDIT_LOG |
  PERM.MENTION_EVERYONE;

export const MOD_PERMS = PERM.KICK | PERM.BAN | PERM.MANAGE_MESSAGES | PERM.CREATE_INVITE;

/** @type {Record<'admin'|'moderator', {name:string, position:number, perms:bigint}>} */
const PRESETS = {
  admin: { name: 'Admin', position: 1, perms: ADMIN_PERMS },
  moderator: { name: 'Moderator', position: 2, perms: MOD_PERMS }
};

/** @param {string} s */
function toBig(s) {
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

/**
 * Classify a member's tier from the folded roles + grants.
 * @param {Array<{role_id:string, permissions:string, deleted?:boolean, scope?:{kind:string}}>} roles
 * @param {Map<string,string[]>|undefined} grants
 * @param {string|undefined} owner
 * @param {string|undefined} member
 * @returns {'owner'|'admin'|'moderator'|null}
 */
export function memberTier(roles, grants, owner, member) {
  if (!member) return null;
  if (member === owner) return 'owner';
  const byId = new Map((roles ?? []).filter((r) => r && !r.deleted).map((r) => [r.role_id, r]));
  const ids = grants?.get?.(member) ?? [];
  /** @type {'admin'|'moderator'|null} */
  let tier = null;
  for (const id of ids) {
    const role = byId.get(id);
    if (!role) continue;
    const perms = toBig(role.permissions);
    if (perms === null) continue;
    if (perms === ADMIN_PERMS) return 'admin';
    if (perms === MOD_PERMS) tier = 'moderator';
  }
  return tier;
}

/**
 * Find the live server-scoped role whose permissions equal the preset's bitmask.
 * @param {Array<{role_id:string, permissions:string, deleted?:boolean, scope?:{kind:string}}>} roles
 * @param {'admin'|'moderator'} tier
 * @returns {string|undefined}
 */
export function presetRoleId(roles, tier) {
  const want = PRESETS[tier]?.perms;
  if (want === undefined) return undefined;
  const match = (roles ?? []).find(
    (r) => r && !r.deleted && r.scope?.kind !== 'channel' && toBig(r.permissions) === want
  );
  return match?.role_id;
}

/** @param {any} community @param {'admin'|'moderator'} tier @returns {Promise<string>} */
export async function ensurePresetRole(community, tier) {
  const preset = PRESETS[tier];
  if (!preset) throw new Error(`unknown role tier: ${tier}`);
  const roles = community.state$?.value?.roles ?? [];
  const existing = presetRoleId(roles, tier);
  if (existing) return existing;
  return community.createRole(preset.name, preset.position, preset.perms);
}

/** @param {any} community */
function presetIdSet(community) {
  const roles = community.state$?.value?.roles ?? [];
  return new Set(
    /** @type {const} */ (['admin', 'moderator'])
      .map((t) => presetRoleId(roles, t))
      .filter((/** @type {string|undefined} */ id) => !!id)
  );
}

/** @param {any} community @param {string} member @param {'admin'|'moderator'} tier */
export async function assignTier(community, member, tier) {
  const roleId = await ensurePresetRole(community, tier);
  const presets = presetIdSet(community);
  const current = community.state$?.value?.grants?.get?.(member) ?? [];
  const next = [...current.filter((/** @type {string} */ id) => !presets.has(id)), roleId];
  await community.grantRoles(member, [...new Set(next)]);
}

/** @param {any} community @param {string} member */
export async function removeTier(community, member) {
  const presets = presetIdSet(community);
  const current = community.state$?.value?.grants?.get?.(member) ?? [];
  await community.grantRoles(
    member,
    current.filter((/** @type {string} */ id) => !presets.has(id))
  );
}
