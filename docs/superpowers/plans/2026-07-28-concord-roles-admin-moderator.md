# Concord Roles (Admin/Moderator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Promote/demote members to Admin or Moderator, and let those roles actually act — re-gate the owner-only Concord management actions to permission (tier)-based checks.

**Architecture:** A new SSR-clean `roles.js` (frozen PERM bits mirrored locally) provides pure tier classification + async grant/create helpers. The concord hook exposes the active user's tier + owner-inclusive capability booleans. The member roster gains promote/demote actions; entry points re-gate from owner-only to capability-based. Dissolve stays owner-only. No SDK/protocol change.

**Tech Stack:** SvelteKit + Svelte 5 runes, RxJS, Vitest, `applesauce-concord` via `src/lib/concord/` only.

## Global Constraints

- `roles.js` must NOT import `applesauce-concord` — mirror the CORD-04 §3 frozen `PERM` bits as local BigInts (documented; exact-pin + package canary guard). It calls `community.createRole`/`grantRoles`/`state$` on the passed-in community object only.
- Gate the UI proactively on tier/capability — the SDK silently folds away unauthorized grants (no throw), so never treat a resolved call as success by itself.
- Owner-inclusive: the owner implicitly holds every permission (`material.owner`).
- **Dissolve stays owner-only.** Only re-gate: new/delete channel (manage-channels), invite entry points (create-invite), kick/ban (moderate), promote/demote (manage-roles + outrank).
- Copy via Paraglide de+en; `pnpm paraglide:compile`.
- Runner: `npx vitest run <file>` (node) / `--environment jsdom` (component).
- TDD.

---

### Task 1: i18n

**Files:** `messages/de.json`, `messages/en.json`

**Produces:** `concord_role_admin`, `concord_role_moderator`, `concord_make_admin`, `concord_make_moderator`, `concord_remove_role`, `concord_role_change_confirm_title`, `concord_role_change_confirm_body`, `concord_role_changed_toast`, `concord_role_change_failed`. (`concord_role_owner` already exists.)

- [ ] **Step 1: `messages/de.json`:**
```json
  "concord_role_admin": "Admin",
  "concord_role_moderator": "Moderator",
  "concord_make_admin": "Zum Admin machen",
  "concord_make_moderator": "Zum Moderator machen",
  "concord_remove_role": "Rolle entfernen",
  "concord_role_change_confirm_title": "Rolle ändern?",
  "concord_role_change_confirm_body": "„{name}“ erhält die Rolle {role}. Das ändert, was diese Person im Bereich tun darf.",
  "concord_role_changed_toast": "Rolle aktualisiert.",
  "concord_role_change_failed": "Rolle konnte nicht geändert werden.",
```
- [ ] **Step 2: `messages/en.json`:**
```json
  "concord_role_admin": "Admin",
  "concord_role_moderator": "Moderator",
  "concord_make_admin": "Make admin",
  "concord_make_moderator": "Make moderator",
  "concord_remove_role": "Remove role",
  "concord_role_change_confirm_title": "Change role?",
  "concord_role_change_confirm_body": "\"{name}\" will get the {role} role. This changes what they can do in the area.",
  "concord_role_changed_toast": "Role updated.",
  "concord_role_change_failed": "Couldn't change the role.",
```
- [ ] **Step 3:** `pnpm paraglide:compile`; confirm `concord_make_admin` compiled.
- [ ] **Step 4: Commit.** `git add messages/de.json messages/en.json src/lib/paraglide && git commit -m "i18n(concord): role management strings"`

---

### Task 2: `roles.js` service + unit tests

**Files:** Create `src/lib/concord/roles.js`; Create `src/lib/__tests__/concord-roles.test.js`

**Produces:** `ADMIN_PERMS`, `MOD_PERMS` (BigInt); `memberTier(roles, grants, owner, member)`; `presetRoleId(roles, tier)`; async `ensurePresetRole(community, tier)`, `assignTier(community, member, tier)`, `removeTier(community, member)`.

- [ ] **Step 1: Write the failing test.** Create `src/lib/__tests__/concord-roles.test.js`:
```js
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
const adminRole = { role_id: 'radmin', name: 'Admin', position: 1, permissions: ADMIN_PERMS.toString(), scope: { kind: 'server' } };
const modRole = { role_id: 'rmod', name: 'Moderator', position: 2, permissions: MOD_PERMS.toString(), scope: { kind: 'server' } };

describe('memberTier', () => {
  it('owner short-circuits', () => {
    expect(memberTier([], new Map(), OWNER, OWNER)).toBe('owner');
  });
  it('classifies admin and moderator by permission bitmask', () => {
    const grants = new Map([[A, ['radmin']], [B, ['rmod']]]);
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

function fakeCommunity({ roles = [], grants = new Map() } = {}) {
  return {
    state$: { value: { roles, grants } },
    createRole: vi.fn(() => Promise.resolve('rnew')),
    grantRoles: vi.fn(() => Promise.resolve())
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
    const c = fakeCommunity({ roles: [adminRole, modRole], grants: new Map([[A, ['rmod', 'rcustom']]]) });
    await assignTier(c, A, 'admin');
    // dropped rmod (a preset), kept rcustom, added radmin
    const call = c.grantRoles.mock.calls[0];
    expect(call[0]).toBe(A);
    expect([...call[1]].sort()).toEqual(['radmin', 'rcustom'].sort());
  });
  it('remove strips only preset ids', async () => {
    const c = fakeCommunity({ roles: [adminRole, modRole], grants: new Map([[A, ['radmin', 'rcustom']]]) });
    await removeTier(c, A);
    expect(c.grantRoles).toHaveBeenCalledWith(A, ['rcustom']);
  });
});
```

- [ ] **Step 2: Run to verify fail.** `npx vitest run src/lib/__tests__/concord-roles.test.js` → FAIL (module missing).

- [ ] **Step 3: Create `src/lib/concord/roles.js`:**
```js
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
```

- [ ] **Step 4: Run to verify pass.** `npx vitest run src/lib/__tests__/concord-roles.test.js` → all pass.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/concord/roles.js src/lib/__tests__/concord-roles.test.js
git commit -m "feat(concord): role presets + tier classification + grant helpers"
```

---

### Task 3: Capability getters on the concord hook

**Files:** Modify `src/lib/concord/community.svelte.js`; extend its test if one exists (`src/lib/__tests__/concord-community-hook.test.js`).

**Interfaces — Produces (on the `concord` object):** `myTier`, `canManageChannels`, `canCreateInvite`, `canModerate`, `canManageRoles`, `canPromoteAdmin`.

- [ ] **Step 1: Write/extend the failing test.** In `concord-community-hook.test.js` (read it first; it mocks the client/state), add a case that sets up a community whose `roles$`/`grants$`/`material.owner` make the active user an admin, and asserts `concord.canManageChannels === true`, `concord.canPromoteAdmin === false` (admin isn't owner), etc.; and an owner case where `canPromoteAdmin === true`. If the hook test's harness can't drive `roles$`/`grants$`, add a focused test of the pure mapping instead (import `memberTier` and assert the tier→capability booleans the hook computes) — real assertion, not vacuous.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Add reactive role reads + capabilities.** In `community.svelte.js`:
  - Import: `import { useActiveUser } from '$lib/stores/accounts.svelte';` and `import { memberTier } from './roles.js';`
  - Near the other `useObservable` getters (`getChannels`, etc.), add:
```js
  const getActiveUser = useActiveUser();
  const getRoles = useObservable(() => {
    const _tick = getConcordState().communities;
    return communityId ? getConcordClient()?.getCommunity(communityId)?.roles$ : undefined;
  }, /** @type {any[]} */ ([]));
  const getGrants = useObservable(() => {
    const _tick = getConcordState().communities;
    return communityId ? getConcordClient()?.getCommunity(communityId)?.grants$ : undefined;
  }, /** @type {Map<string,string[]>} */ (new Map()));
```
  - In the returned object, compute and add:
```js
      // (before `return {`)
      const myTier = memberTier(getRoles(), getGrants(), community?.material?.owner, getActiveUser()?.pubkey);
      // (inside the returned object)
      myTier,
      canManageChannels: myTier === 'owner' || myTier === 'admin',
      canCreateInvite: myTier === 'owner' || myTier === 'admin' || myTier === 'moderator',
      canModerate: myTier === 'owner' || myTier === 'admin' || myTier === 'moderator',
      canManageRoles: myTier === 'owner' || myTier === 'admin',
      canPromoteAdmin: myTier === 'owner',
```
  - Update the JSDoc `@returns` typedef (line ~55 and the wrapper's at ~133) to include the new fields, and ensure the wrapper function (`useConcordAreaForCommunity` — the one that spreads the base result and adds `pointer`) passes the new fields through (if it spreads `...base`, no change; if it re-lists fields, add them).

- [ ] **Step 4: Run to verify pass + typecheck.** Test passes; `pnpm check 2>&1 | grep community.svelte | grep -i error || echo clean`.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/concord/community.svelte.js src/lib/__tests__/concord-community-hook.test.js
git commit -m "feat(concord): expose myTier + capability flags on the concord hook"
```

---

### Task 4: Member-roster role actions + kick/ban re-gate

**Files:** Modify `src/lib/components/community/channels/ChannelMembersModal.svelte`; Modify `src/lib/components/__tests__/ChannelMembersModal.test.js`

**Interfaces — Consumes:** new props `canModerate`, `canManageRoles`, `canPromoteAdmin`, `myTier` (actor's tier), plus existing `isOwner`, `signerHasNip44`; `assignTier`/`removeTier`/`memberTier` from `roles.js`.

- [ ] **Step 1: Write failing tests (extend `ChannelMembersModal.test.js`).** Mock `$lib/concord/roles.js` (`assignTier`/`removeTier` spies; real `memberTier`) and render with a community whose `roles$`/`grants$` classify a target member. Assert:
  - Owner actor: a member row shows "Zum Admin machen" and "Zum Moderator machen"; clicking "Zum Admin machen" → confirm → `assignTier(community, member, 'admin')`.
  - Admin actor (`canPromoteAdmin=false`, `canManageRoles=true`): shows "Zum Moderator machen" but NOT "Zum Admin machen"; can demote a moderator (`removeTier`) but the make-* actions are hidden for another admin/owner row.
  - Moderator actor (`canManageRoles=false`): no role actions at all.
  - kick/ban buttons appear when `canModerate` (not only owner).
  Reuse the file's existing mock setup (`useObservable`, `memberSections`, profile map). Do not weaken the assertions.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement.** In `ChannelMembersModal.svelte`:
  - Props: add `canModerate = false, canManageRoles = false, canPromoteAdmin = false, myTier = null` to `$props()`.
  - Import `assignTier`, `removeTier`, `memberTier` from `$lib/concord/roles.js`.
  - Compute each row's target tier: `memberTier(getRoles(), getGrants(), community?.material?.owner, pubkey)`.
  - Outrank helper (pure, inline or module):
```js
    // Owner acts on anyone; admin only on moderators/roleless; nobody acts on the owner.
    function canActOnTier(actorTier, targetTier) {
      if (targetTier === 'owner') return false;
      if (actorTier === 'owner') return true;
      if (actorTier === 'admin') return targetTier === 'moderator' || targetTier === null;
      return false;
    }
```
  - Re-gate kick/ban: change `{#if isOwner && !self}` → `{#if canModerate && !self}`.
  - Add role actions in the member row (for `!self`), each opening a confirm then calling the mutation:
    - "Zum Admin machen": show when `canPromoteAdmin && targetTier !== 'admin' && targetTier !== 'owner'` → `assignTier(community, pubkey, 'admin')`.
    - "Zum Moderator machen": show when `canManageRoles && canActOnTier(myTier, targetTier) && targetTier !== 'moderator'` → `assignTier(community, pubkey, 'moderator')`.
    - "Rolle entfernen": show when `canManageRoles && canActOnTier(myTier, targetTier) && (targetTier === 'admin' || targetTier === 'moderator')` → `removeTier(community, pubkey)`.
    Use a confirm modal like the existing kick/ban `confirm` state (extend it to a role variant, or a second confirm state), with `concord_role_change_confirm_*` copy and `concord_role_changed_toast`/`concord_role_change_failed`.
  - Tier chip: replace the leader chip `leader.roleName` with a localized label when the role is a preset — `targetTier === 'admin' ? m.concord_role_admin() : targetTier === 'moderator' ? m.concord_role_moderator() : leader.roleName` (owner still `concord_role_owner`).

- [ ] **Step 4: Run to verify pass.** `npx vitest run --environment jsdom src/lib/components/__tests__/ChannelMembersModal.test.js` → all pass.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/components/community/channels/ChannelMembersModal.svelte src/lib/components/__tests__/ChannelMembersModal.test.js
git commit -m "feat(concord): promote/demote Admin+Moderator in the member roster; kick/ban by capability"
```

---

### Task 5: Re-gate entry points (PrivateChannelsView + ChannelChat)

**Files:** Modify `src/lib/components/community/channels/PrivateChannelsView.svelte`; Modify `src/lib/components/community/channels/ChannelChat.svelte`; extend their tests.

- [ ] **Step 1: Write failing tests.** For `ChannelChat.test.js`: with `canCreateInvite=false` the header "Einladen" button and the ⋯ invite item are absent; with `canManageChannels=false` the ⋯ "Kanal löschen" item is absent (even at channelCount>1); dissolve item still gated on `isOwner`. For `PrivateChannelsView` (management/shared-selection harness): `+ Neuer Kanal` shows when `concord.canManageChannels` is true for a non-owner admin (mock the hook fixture's `canManageChannels: true`) and hidden when false. Reuse existing harnesses; don't weaken.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: ChannelChat re-gate.** In `ChannelChat.svelte`:
  - Props: add `canCreateInvite = false, canManageChannels = false` to `$props()` (keep `isOwner`).
  - Header Einladen button: gate `{#if !dissolved && canCreateInvite}` (was `{#if !dissolved}`).
  - ⋯ menu invite item: `{#if !dissolved && canCreateInvite}` (was `{#if !dissolved}`).
  - ⋯ menu delete-channel item: `{#if canManageChannels && !dissolved && channelCount > 1}` (was `isOwner && ...`).
  - ⋯ menu dissolve item: unchanged (`{#if isOwner && !dissolved}`).
  - dissolved-banner recover button: unchanged (`{#if isOwner}`).

- [ ] **Step 4: PrivateChannelsView re-gate + pass caps.** In `PrivateChannelsView.svelte`:
  - `+ Neuer Kanal` rail button: gate `{#if concord.community && concord.canManageChannels && !concord.dissolved}` (was `isConcordOwner`).
  - `<ChannelChat ... />`: add `canCreateInvite={concord.canCreateInvite}` and `canManageChannels={concord.canManageChannels}` (keep `isOwner={isConcordOwner}` for dissolve/recover).
  - `<ChannelMembersModal ... />`: add `canModerate={concord.canModerate}`, `canManageRoles={concord.canManageRoles}`, `canPromoteAdmin={concord.canPromoteAdmin}`, `myTier={concord.myTier}` (keep `isOwner={isConcordOwner}`).
  - The dissolve overlay/menu path stays `isConcordOwner`. The found-pane "new channel" (Communikey-owner path) stays `isCommunikeyOwner` — leave it.

- [ ] **Step 5: Run to verify pass.** `npx vitest run --environment jsdom src/lib/components/__tests__/ChannelChat.test.js src/lib/components/__tests__/PrivateChannelsView.test.js src/lib/components/__tests__/PrivateChannelsView.management.test.svelte.js` → all pass. Existing tests that render these components without the new props rely on the `false` defaults — confirm they still pass (owner-path tests may need `canManageChannels`/`canCreateInvite` props added where they previously relied on `isOwner`).

- [ ] **Step 6: Commit.**
```bash
git add src/lib/components/community/channels/PrivateChannelsView.svelte src/lib/components/community/channels/ChannelChat.svelte src/lib/components/__tests__/
git commit -m "feat(concord): re-gate channel/invite/moderation actions to capabilities"
```

---

### Task 6: Verification

- [ ] **Step 1: Typecheck.** `pnpm check 2>&1 | grep -iE "roles|community.svelte|ChannelMembersModal|PrivateChannelsView|ChannelChat" | grep -i error || echo clean`.
- [ ] **Step 2: Suites.** `npx vitest run src/lib/__tests__/concord-roles.test.js` and the touched component/hook tests → all pass.
- [ ] **Step 3: Browser (owner path + regression).** As the owner on the live area: the member roster (👥 → Mitglieder) shows "Zum Admin/Moderator machen" on a member (e.g. laoc42); promoting shows a role chip; `+ Neuer Kanal`, Einladen, and delete still work (owner has all caps). No console errors. (Full admin-acting verification would need logging in as the promoted member — note as component-tested.)
- [ ] **Step 4: Final commit if fixes needed.**

## Self-Review

- **Spec coverage:** presets + tier logic → Task 2; capability hook → Task 3; promote/demote UI + kick/ban re-gate → Task 4; entry-point re-gate → Task 5; i18n + tests → Task 1 + each. Dissolve stays owner-only (Tasks 4/5 leave those gates). ✓
- **Type/name consistency:** `memberTier`, `presetRoleId`, `ensurePresetRole`, `assignTier`, `removeTier`, `ADMIN_PERMS`/`MOD_PERMS`, `myTier`, `canManageChannels`/`canCreateInvite`/`canModerate`/`canManageRoles`/`canPromoteAdmin` used identically across tasks. ✓
- **Placeholder scan:** roles.js + tests fully concrete; hook + component steps give exact current→new gating expressions and reuse existing harnesses (adapt, don't weaken). ✓
- **Scope:** two presets only; no custom-role editor; dissolve owner-only; frozen PERM mirrored + documented; no SDK/protocol change. ✓
