# NIP-29 Completion — Design

**Date:** 2026-08-11
**Branch:** `feat/community-group-pointer` (worktree `.worktrees/group-pointer`)
**Issue:** nostr `c29021c100c50ede282263abed3820dd8d3d61d1712a8439c80ce86832a184e8` — "Full NIP-29 and concord support."

## Scope

Close the remaining gaps of the issue on the existing branch:

1. **NIP-29 group creation** from the community attach modal (kind 9007), with
   protocol feature notices for both Concord and NIP-29.
2. **Members-with-roles UI** for NIP-29 groups (39001 admins + 39002 members).
3. **Role management** for NIP-29 groups: add/remove members, promote/demote
   admins, edit group metadata (9002), delete group (9008).
4. **Concord-XOR-NIP-29 per community** — already enforced by
   `attachableAreaModes` (`src/lib/groups/community-attach.js`); this cycle
   only keeps it covered, no new code. Clarified rule (laoc): one kind-10222
   community links to EITHER one Concord area OR NIP-29 channels, never both.

Out of scope: CORD-07 A/V calls (blocked on infra), NIP-29 invites (9009),
sending zaps, any Concord-side changes.

## Decisions (from brainstorming, 2026-08-11)

- Creation lives **inside `AreaAttachModal`'s group tab** (attach-existing and
  create-new sub-modes). No standalone create entry point.
- Host relay: new **`GROUPS_RELAYS` env** default, preselected, with a
  free-text override field.
- v1 management actions: **all four** — add/remove members, promote/demote
  admins, edit metadata, delete group.
- Create form exposes both NIP-29 marker pairs, **default private + closed**
  (matches the "protected area" framing and the access glyphs).

## Architecture

One new helper lane, `src/lib/groups/group-management.js`, wrapping the
applesauce-common factories (`CreateGroupFactory` 9007, `PutUserFactory` 9000,
`RemoveUserFactory` 9001, `EditGroupMetadataFactory` 9002, `DeleteGroupFactory`
9008 — all in `applesauce-common/factories/group-management`, already in the
tree). Events are signed by the **acting user** and published **to the group
relay only** via `pool.relay(relay).publish()` with the existing
`authenticateOnce` NIP-42 handling (`src/lib/groups/relay-auth.js`) — the same
pattern `GroupChat` uses for messages and join/leave. Explicitly NOT the
outbox `publishEvent()` path: management events must not fan out to write
relays.

Shared send helper:

```
publishToGroupRelay(pointer, template, signer) -> {ok, reason?}
```

sign → publish → on `auth-required:` run `authenticateOnce` and retry once →
return the relay's OK result. No optimistic EventStore writes; the UI reflects
the relay's re-broadcast 39000/39001/39002 (the metadata subscription GroupChat
already holds).

## Components

### 1. Creation flow — `AreaAttachModal` group tab

Two sub-modes: **attach existing** (unchanged) and **create new**.

Create form fields:

- name (required), about (optional), picture URL (optional)
- toggle "visible to non-members" → public/private marker (default: private)
- toggle "anyone can join" → open/closed marker (default: closed)
- host relay: preselected from `getGroupsRelays()` (new helper in
  `relay-helper.js`, backed by `GROUPS_RELAYS` env →
  `runtimeConfig.appRelays.groups`); free-text override validated with
  `isValidRelayUrl`.

Submission sequence:

1. Generate a random group id (hex, Armada-style).
2. Send kind 9007 (create) as the acting user to the chosen relay.
3. Send kind 9002 with the metadata fields (name/about/picture/markers).
   (`CreateGroupFactory.create(groupId, metadata)` may already embed the
   metadata in the 9007 — verify at implementation time; if it does, skip
   this step.)
4. Wait for the relay's 39000 for the new id (bounded wait, e.g. 10 s) to
   confirm the group exists.
5. Auto-attach the pointer to the community via the existing
   `attachGroupChannel` with the community signer (modal already resolves it).

Failure at any step surfaces the relay reason as an error toast and stops; a
group created but not attached is recoverable via attach-existing.

The XOR gate stays as-is: `attachableAreaModes` hides the whole tab when a
Concord pointer exists.

### 2. Feature notices

When BOTH tabs are on offer, each tab renders a short notice card above its
content (paraglide messages, de + en):

- **Concord:** end-to-end encrypted; contents invisible to the relay;
  membership by invitation; works with edufeed and Armada.
- **NIP-29:** membership managed by the group relay; contents readable by the
  relay; interoperable across many Nostr clients; public or private.

One message pair per protocol.

### 3. Members-with-roles UI — `GroupMembersModal.svelte`

New component in `src/lib/components/groups/`, mirroring Concord's
`ChannelMembersModal`. Opened from the member count in `GroupChat`'s header.

- Section "Admins": pubkeys from 39001 with their role names as chips.
- Section "Members": pubkeys from 39002.
- Profiles via `useProfileMap`; rows reuse the existing profile-row idiom.
- Data flows in as props from GroupChat's existing metadata subscription; the
  modal is presentational plus action callbacks.

### 4. Role management

Visibility rule: management actions render only when the signed-in user is
listed in 39001 (any role). Fine-grained permissions stay with the relay; an
OK:false becomes an error toast carrying the relay's reason.

- **Add member:** `ContactSearchInput` → put-user 9000.
- **Remove member:** remove-user 9001, with confirm.
- **Promote:** put-user with a role — role names offered from the relay's
  39003 list when present, fallback `admin`.
- **Demote:** put-user with empty roles.
- **Edit metadata:** small sheet from the group header, prefilled from 39000
  (name/about/picture/toggles), publishes 9002.
- **Delete group:** kind 9008 behind a confirm dialog in that sheet. On
  success: detach the community pointer (if attached and the user can sign for
  the community) and remove the group from the personal 10009 list.

## Error handling

All management sends go through `publishToGroupRelay` (auth-retry once, toast
on failure). Creation's bounded 39000 wait fails loud, never hangs the modal.
No optimistic writes anywhere in the management lane.

## Testing (TDD, unit/component first)

- `src/lib/__tests__/group-management.test.js`: each template's kind + tags
  against NIP-29 shapes; auth-retry path; create→confirm→attach sequence with
  a mocked relay (including failure at each step).
- Component tests: create form (validation, toggle defaults, relay override),
  `GroupMembersModal` (admin gating, callbacks fire with the right args),
  notice cards (rendered only when both modes are available),
  `attachableAreaModes` coverage kept green.
- No new E2E.

## Housekeeping (after implementation)

Merge dev's pending commit (`2e997b40`) into the branch, run the full vitest
suite + `pnpm check`, prep the branch for merge into dev.
