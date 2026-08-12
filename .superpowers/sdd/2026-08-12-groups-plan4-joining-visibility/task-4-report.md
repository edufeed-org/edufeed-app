# Task 4 report: moderated join button (9021 + invite codes, applicant side)

**Status:** done

**Commit:** `796d46ec` on `feat/community-group-pointer` (not pushed)
`feat(community): moderated join button with 9021 + invite codes`

**Tests:** 69/69 passing across the touched/adjacent suites (new
`join-community-group.test.js`: 4; extended `CommunityProfileHero.test.js`:
11, up from 2; `groups-helpers.test.js`, `group-management.test.js`,
`community-group-attach.test.js` unaffected/still green). `svelte-check`:
0 errors (7 pre-existing unrelated warnings). `pnpm run lint`: clean.

## What was built

- **`src/lib/groups/join-community-group.js`** (new) — `joinCommunityGroup({pointer, code, user})`
  builds a kind-9021 via `buildJoinRequestTemplate` (with or without the
  `code` tag) and sends it through `publishToGroupRelay` to
  `pool.relay(pointer.relay)`, rethrowing the relay's rejection reason.
- **`src/lib/components/community/views/CommunityProfileHero.svelte`** — added
  an independent moderated-community join lane beside the existing
  kind-30000 follow button:
  - `useRootRoster(() => communikeyEvent)` + `useChannelMetadata` (root
    pointer only) instantiated at component init.
  - Roster member → "Mitglied"/"Member" badge.
  - Non-member + application-tag community → existing request-join-form
    button, untouched.
  - Non-member, no application tag → bare-9021 join button, hidden only
    when the root group's kind:39000 carries a `closed` tag (distinct from
    the `private` read-access tag `channel-access.js` reads); an
    invite-code redeem input is *always* shown regardless of the closed
    marker.
  - Session-local `requestSent` state renders the pending message after a
    successful send and calls the roster's `refresh()`.
  - `isMembershipRefusal` errors get the friendlier "declined" toast;
    other rejections show `community_join_failed` with the relay reason.
  - Anonymous users (`useActiveUser()` returns falsy) get none of the new
    affordances.
- **i18n**: added `community_join_group`, `community_join_pending`,
  `community_join_member`, `community_join_invite_toggle`,
  `community_join_invite_placeholder`, `community_join_invite_submit`,
  `community_join_refused`, `community_join_failed` to both
  `messages/de.json` and `messages/en.json`.

## Testing approach

- Service test mocks `$lib/stores/nostr-infrastructure.svelte`'s `pool`
  only; asserts signed-event shape (kind 9021, `h`/`code` tags), relay
  targeting, and rethrow-on-rejection — mirrors the existing
  `group-management.test.js` style.
- Hero test mocks `useRootRoster`, `useChannelMetadata`, `useActiveUser`,
  and `joinCommunityGroup` via `vi.hoisted` holders, plus `svelte`'s
  `getContext` (same pattern already used in `ChannelInviteSheet.test.js`)
  to control the `communityWideFormRef` context without a wrapper
  component. Covers: member badge, application-tag path preserved, join
  button shown/hidden by the 39000 `closed` marker, invite-code
  toggle→type→submit flow (asserts the service mock received the code),
  bare-join pending-state flip, anonymous no-op, and both toast branches
  (refusal vs. generic reason).

## Concerns

- None outstanding for this task's scope. The invite-code UI is a minimal
  inline toggle+input+button (no dedicated component) — consistent with
  the brief's "small affordance" framing; Task 5 (invite-code minting, the
  admin/moderator side) will presumably need a distinct UI and is not
  affected by this change.
- Did not touch `HomeView.svelte`/`ClosedCommunityShell.svelte` (both pass
  `communikeyEvent` through unchanged) — no test file exists for
  `HomeView` in this repo, so no adjacent suite needed re-verification
  there.

## Fix pass (code review)

**Commit:** `7d316695` on `feat/community-group-pointer` (not pushed)
`fix(community): join lane waits for roster/metadata, missing 39000 counts as closed`

**Finding addressed:** no load-gating on the two async signals deciding the
moderated join lane — (a) `isRootClosed` defaulted to *open* while the
39000 hadn't arrived, letting a closed group briefly show a bare Join
button whose 9021 the relay would silently ignore, stranding the user in
"pending" forever; (b) `isRosterMember` defaulted `false` while the roster
was still loading, so an actual member could briefly see join affordances.
The codebase's existing convention for this exact 39000 read
(`channel-access.js`) is to fall back to the LOCK when metadata is
missing/unrecognised — "overstating openness is the harmful direction" —
which this component's `isRootClosed` had not been following.

**Changes in `CommunityProfileHero.svelte`:**

1. Read `isLoading` from `useRootRoster()` into a new `isRosterLoading`
   derived. The entire moderated join block (badge exclusion aside — a
   member badge only ever renders once `isMember` is actually true, so it
   was never at risk of a false positive) now renders a small muted
   spinner placeholder instead of any join affordance while the roster is
   loading — no bare-join button, no invite-code toggle, nothing
   clickable until the roster has answered.
2. Flipped `isRootClosed`'s default: `!rootMetadataEvent || <has 'closed' tag>`.
   A 39000 that hasn't arrived yet (or an unreachable metadata relay) now
   counts as closed, matching `channel-access.js`'s lock-direction
   convention. The bare join button appears only once a 39000 *without*
   `closed` has actually loaded. The invite-code affordance is unaffected
   by this flag by design — it stays available (once the roster itself has
   loaded) regardless of the 39000's state, since a code redemption is
   always legitimate even against a closed or not-yet-known group.
3. Minor a11y nit: added `aria-label={m.community_join_invite_placeholder()}`
   to the invite-code `<input>` (previously relied on the visual
   placeholder alone).

**Tests added/changed in `CommunityProfileHero.test.js`:**

- `roster still loading: renders no join affordances at all (not even
  invite-code)` — new; `holders.isRosterLoading = true` → neither "Join"
  nor "Redeem invite code" nor "Member" render.
- `root 39000 not yet loaded (empty byKey): counts as closed —
  invite-code only, no bare Join` — new; empty `metadataByKey` → invite
  toggle renders, bare Join button does not.
- The existing "root group not closed" test now passes because the
  describe block's `beforeEach` seeds `holders.metadataByKey` with a
  present, non-closed 39000 event by default (`OPEN_ROOT_METADATA`) —
  previously that test relied on the (now-flipped) "missing means open"
  default, so without this seed it would have started failing under the
  fix. The "root group closed" test overrides the same key with an
  explicit `closed` tag, as before.
- Invite-code submission test switched from `getByPlaceholderText('Code')`
  to `getByLabelText('Code')`, exercising the new `aria-label` wiring.

**Verification:** `pnpm exec vitest run
src/lib/components/__tests__/CommunityProfileHero.test.js
src/lib/__tests__/join-community-group.test.js` → 17/17 passing.
`svelte-check`: 0 errors (same 7 pre-existing unrelated warnings).
`pnpm run lint`: clean.
