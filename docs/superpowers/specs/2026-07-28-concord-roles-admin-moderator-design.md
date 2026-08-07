# Concord Roles: Admin + Moderator + permission-gated actions — Design

**Date:** 2026-07-28
**Status:** Approved (design + scope), pending plan
**Branch:** `worktree-cordn-groups`

## Problem

You can't promote anyone to admin. Two reasons (verified against `applesauce-concord/dist`):
1. There is **no promote/demote UI** — the app never calls `createRole`/`grantRoles`.
2. Even if it did, the app **gates every action on `material.owner === you`** (owner-only), never on
   roles/permissions — so a granted role would confer no UI power.

## Protocol facts (CORD-04, verified)

- Permissions are **frozen BigInt bit flags** (`types.js` `PERM`): `MANAGE_ROLES=1n<<0`,
  `MANAGE_CHANNELS=1n<<1`, `MANAGE_METADATA=1n<<2`, `KICK=1n<<3`, `BAN=1n<<4`,
  `MANAGE_MESSAGES=1n<<5`, `CREATE_INVITE=1n<<6`, `VIEW_AUDIT_LOG=1n<<8`, `MENTION_EVERYONE=1n<<9`.
  `ADMIN_PERMS` = union of all.
- Roles are custom: `{ role_id, name, position (lower = higher authority; owner = 0), permissions
  (stringified BigInt), scope ({kind:'server'}), color, deleted }`. Owner is implicit
  (`material.owner`), all-powerful, position 0.
- `createRole(name, position, permissions, scope?)` → roleId; `editRole`, `deleteRole`;
  `grantRoles(member, roleIds)` publishes the member's **full** role-id set (not additive).
- Authority is enforced at **fold/read time**: to grant a role the caller must be **owner**, OR hold
  `MANAGE_ROLES` **and strictly outrank** the granted role (`role.position > caller.position`).
  `createRole` similarly rejects a role at/above the caller's own position. The client does **not**
  throw for an unauthorized attempt — the event is silently folded away, so the **UI must gate
  proactively**.
- Reactive sources on the community object: `roles$`, `grants$` (`Map<pubkey, roleId[]>`),
  `members$`, `standing$(member)`, `canDo$(perm, pos)`, `canDoAgainst$(perm, member)`.
- Current app: `ChannelMembersModal` shows role-name chips + kick/ban (owner-gated); `roster.js`
  `memberSections()` splits owner/leaders/members; `moderation.js` wraps kick/ban. **No role
  mutation anywhere.**

## Design

### Two preset roles (tiers)

- **Admin** — `permissions = ADMIN_PERMS` (all bits), `position = 1`.
- **Moderator** — `permissions = KICK | BAN | MANAGE_MESSAGES | CREATE_INVITE`, `position = 2`.

Positions give the hierarchy owner(0) > admin(1) > moderator(2). Consequences of the fold rule:
- Only the **owner** (pos 0) can mint/grant the **Admin** role (pos 1) — an admin (pos 1) can't
  grant a role at pos ≤ 1.
- Owner **and** admins can grant **Moderator** (pos 2).

### `src/lib/concord/roles.js` (new, SSR-clean — no `applesauce-concord` import)

Mirror the frozen `PERM` bits as local BigInt constants (CORD-04 §3 frozen; guarded by the exact-pin
+ the package's vitest canary — comment to keep in sync), so classification/preset-building stays
synchronous. Exports:
- `ADMIN_PERMS`, `MOD_PERMS` (BigInt).
- Pure: `memberTier(roles, grants, owner, member) → 'owner' | 'admin' | 'moderator' | null` —
  owner short-circuits; else classify the member's granted roles by matching
  `BigInt(role.permissions)` against `ADMIN_PERMS`/`MOD_PERMS` (admin wins if both).
- Pure: `presetRoleId(roles, tier) → string | undefined` — find a live server role whose permissions
  equal the preset's bitmask.
- Async mutations (call the SDK on the passed `community`):
  - `ensurePresetRole(community, tier)` → roleId: `presetRoleId(...)` from `community.state$.value.roles`
    or `community.createRole(name, position, perms)`.
  - `assignTier(community, member, tier)`: `roleId = await ensurePresetRole(...)`; new set =
    (current grants for member, minus BOTH preset role ids) + `[roleId]`; `community.grantRoles(member, newSet)`
    (presets are mutually exclusive; non-preset roles preserved).
  - `removeTier(community, member)`: `community.grantRoles(member, currentMinusPresetIds)`.

### `src/lib/concord/community.svelte.js` (hook) — capability getters

Reactively compute the **active user's** tier from `roles$`+`grants$`+`material.owner`
(`memberTier(...)`) and expose owner-inclusive capability booleans on the `concord` object:
- `myTier` (`'owner'|'admin'|'moderator'|null`)
- `canManageChannels` = tier ∈ {owner, admin}
- `canCreateInvite` = tier ∈ {owner, admin, moderator}
- `canModerate` (kick/ban) = tier ∈ {owner, admin, moderator}
- `canManageRoles` = tier ∈ {owner, admin}
- `canPromoteAdmin` = tier === owner

(Owner-inclusive because the fold treats the owner as holding every permission.)

### Re-gate owner-only actions → capability-based

- **`PrivateChannelsView.svelte`**: `+ Neuer Kanal` → `canManageChannels` (was `isConcordOwner`);
  pass the capability flags to `ChannelChat` and `ChannelMembersModal`. **Dissolve stays
  `isConcordOwner`** (drastic; SDK's `dissolve()` rejects non-owners).
- **`ChannelChat.svelte`**: header **Einladen** + `⋯`→Einladen → `canCreateInvite`;
  `⋯`→**Kanal löschen** → `canManageChannels`; **Mitglieder** → everyone; **Auflösen** → owner only
  (unchanged prop). Add the new capability props.
- **`ChannelMembersModal.svelte`**:
  - kick/ban buttons → `canModerate` (was `isOwner`); keep the self-guard + `signerHasNip44` gate.
  - **New per-member role actions:** for a non-self member, show a small role control —
    "Zum Admin machen" (only when `canPromoteAdmin`), "Zum Moderator machen" (when `canManageRoles`),
    and "Rolle entfernen" (when the member has a preset role and the actor `canManageRoles` +
    outranks them). Each opens a confirm, then calls `assignTier`/`removeTier` (roles.js) with a
    success/failure toast. Show the member's tier chip (Owner/Admin/Moderator) from `memberTier`.
  - Outrank guard in the UI: an admin may not demote/re-role another admin or the owner (only the
    owner can); mirror `canDoAgainst`-style logic with the local tier + positions so the UI doesn't
    offer an action the fold would silently drop.

### i18n (de + en)

`concord_role_admin`, `concord_role_moderator` (chip labels; `concord_role_owner` already exists);
`concord_make_admin`, `concord_make_moderator`, `concord_remove_role`;
`concord_role_change_confirm_title` (param name+role), `concord_role_change_confirm_body`;
`concord_role_changed_toast`, `concord_role_change_failed`.

## Testing

- **`roles.js` unit** (node): `memberTier` classifies owner/admin/moderator/none correctly (incl.
  admin-wins-if-both, deleted roles ignored); `presetRoleId` matches by bitmask; `assignTier`
  computes the right full grant set (mutually exclusive presets, preserves non-preset roles) and
  calls `grantRoles`; `ensurePresetRole` reuses an existing preset role and only creates when
  absent; `removeTier` strips preset ids only.
- **`community.svelte.js` hook**: capability booleans map correctly from tier (extend the existing
  hook test if present).
- **`ChannelMembersModal`**: promote calls `assignTier(community, member, 'admin'|'moderator')`;
  remove calls `removeTier`; role actions are hidden/shown per capability (owner sees make-admin;
  admin sees make-moderator but not make-admin; moderator sees none); kick/ban gated on `canModerate`.
- **Re-gate**: `PrivateChannelsView` shows `+ Neuer Kanal` when `canManageChannels` (not only owner);
  `ChannelChat` shows Einladen when `canCreateInvite`.

## Scope boundaries

- Only two preset tiers — **no** custom-role editor, no per-permission checkboxes, no role color/rename.
- **Dissolve stays owner-only.** Area attach/detach + found (Communikey-owner concerns) unchanged.
- No SDK/relay/protocol changes; frozen `PERM` bits mirrored locally (documented, canary-guarded).
- Message moderation (`MANAGE_MESSAGES`) grants the bit but no message-delete UI is added here
  (out of scope — the tier just carries the permission for future use).

## Files touched

- New: `src/lib/concord/roles.js` (+ unit test)
- `src/lib/concord/community.svelte.js` (capability getters)
- `src/lib/components/community/channels/ChannelMembersModal.svelte` (role actions + kick/ban re-gate)
- `src/lib/components/community/channels/PrivateChannelsView.svelte` (re-gate + pass caps)
- `src/lib/components/community/channels/ChannelChat.svelte` (re-gate + caps props)
- `messages/de.json`, `messages/en.json`, tests
