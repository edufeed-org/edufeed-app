# NIP-29 Stories — edufeed-app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make moderated-community channels behave per laoc's user stories: world channels are truly open (self-join + write instantly), members join channels by their own decision (admins pre-joined), npub invites arrive as consent-based DM invitations, and the linked NIP-29 group's metadata follows the 10222 profile.

**Architecture:** All group operations stay in `src/lib/groups/` (template builders in `group-management.js`, publish via `publishToGroupRelay` with NIP-42 handling). Channel semantics ride NIP-29 metadata flags (`open` = absence of `closed`) plus the spec's `parent` tag linking channels to the community's root group; the members-tier blanket fan-out is retired in favor of relay-side self-join (pyramid-edufeed R2) with graceful pending-queue degradation, while fan-out/reconcile machinery is repurposed for admins only.

**Tech Stack:** SvelteKit + Svelte 5 runes, applesauce (pool.relay, EventStore), Vitest (node + jsdom), paraglide i18n (keys in BOTH `messages/de.json` AND `messages/en.json`).

**Spec:** `docs/superpowers/plans/2026-08-19-nip29-stories-roadmap.md` (decisions + verified relay facts). Original architecture: `docs/superpowers/specs/2026-08-12-groups-architecture-design.md`.

## Global Constraints

- Work ONLY in `/home/laoc/coding/edufeed/edufeed-app/.worktrees/group-pointer`. NEVER `git push` (laoc pushes).
- Commits end with `Claude-Session: https://claude.ai/code/session_011Na3juB2TLLr7L7wRq8KWu` and `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Use `git commit -F - <<'MSG'` heredocs (zsh mangles backticks in `-m`).
- Every new user-facing string: add the key to `messages/de.json` AND `messages/en.json`, and to each test file's paraglide mock.
- Buttons: `btn-sm` chrome default, plain `btn` in modals/forms, `btn-xs` only icon-only chrome (CLAUDE.md "Buttons").
- `$state.raw` for event arrays / Sets / Maps, replaced wholesale.
- TDD: failing test first. Component tests under `src/lib/components/__tests__/`, unit tests under `src/lib/__tests__/`.
- Relay facts to honor: pyramid rejects moderation events with `created_at` older than 60s; invite codes are single-use; `create-invite` is rejected on open groups.

---

### Task A1: World channels become open groups

**Files:**
- Modify: `src/lib/groups/access-choice.js`
- Test: `src/lib/__tests__/access-choice.test.js` (extend; create if absent)

**Interfaces:**
- Produces: `accessChoiceToNip29({tier, worldReadable})` now returns `isOpen: true` **iff** `tier === 'members' && worldReadable === true` (the "world" channel). All other tiers stay `isOpen: false`.
- Consumed by: `ChannelCreateWizard.svelte` line ~251 (`const { isPublic, isOpen, access } = accessChoiceToNip29(...)`) — no wizard change needed; `metadataTags` in `group-management.js` already maps `isOpen` → omit `['closed']`.

- [ ] **Step 1: Write the failing test** — in `access-choice.test.js`:

```javascript
it('world channels are open groups — bare 9021 self-join, no admin approval', () => {
  const world = accessChoiceToNip29({ tier: 'members', worldReadable: true });
  expect(world).toMatchObject({ isPublic: true, isOpen: true });
  // members-only and invited channels stay closed (join needs relay policy or code)
  expect(accessChoiceToNip29({ tier: 'members', worldReadable: false }).isOpen).toBe(false);
  expect(accessChoiceToNip29({ tier: 'invited' }).isOpen).toBe(false);
});
```

- [ ] **Step 2: Run it, verify FAIL** — `pnpm vitest run src/lib/__tests__/access-choice.test.js` → world case fails (`isOpen` currently always false).
- [ ] **Step 3: Implement** — in `access-choice.js`, set `isOpen: tier === 'members' && worldReadable === true` and update the file-top comment (the "always isOpen:false, design B2" note is superseded by laoc 2026-08-19: world channels self-join).
- [ ] **Step 4: Run the test file + `ChannelCreateWizard.test.js`** — both green (wizard tests may assert `closed` tags for world channels; update those assertions to the new truth if they do).
- [ ] **Step 5: Commit** — `feat(groups): world channels are open groups (self-join)`.

---

### Task A2: Channels carry the spec `parent` tag pointing at the root group

**Files:**
- Modify: `src/lib/groups/group-management.js` (`metadataTags`, both template builders' JSDoc)
- Modify: `src/lib/components/community/channels/ChannelCreateWizard.svelte` (~line 256, the `metadata:` object)
- Test: `src/lib/__tests__/groups-management.test.js` (or the existing group-management test file), `src/lib/components/__tests__/ChannelCreateWizard.test.js`

**Interfaces:**
- Produces: `metadataTags(meta)` appends `['parent', meta.parent]` when `meta.parent` is a non-empty string. Meta type gains `parent?: string`.
- Consumes: the wizard's NIP-29 branch already holds `membershipPointer` (root pointer `{id, relay}`); it passes `parent: membershipPointer.id` **only when** `normalizeURL(relay) === normalizeURL(membershipPointer.relay)` (a parent on a different relay is meaningless — the tag is relay-scoped per spec).

- [ ] **Step 1: Failing unit test** — assert `buildEditGroupMetadataTemplate('ch1', { name: 'x', isPublic: true, isOpen: true, parent: 'root1' }).tags` contains `['parent', 'root1']`, and that omitting `parent` yields no such tag.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** in `metadataTags`; wire `parent` in the wizard's `metadata: { name: name.trim(), isPublic, isOpen }` → `metadata: { name: name.trim(), isPublic, isOpen, parent: sameRelay ? membershipPointer.id : undefined }` (compute `sameRelay` with `normalizeURL` from `applesauce-core/helpers/url`).
- [ ] **Step 4: Failing wizard test** — extend the existing create-flow spec: the published 9002 (captured by the existing `poolRelaySpy`) carries `['parent', <root id>]`.
- [ ] **Step 5: Run wizard test → green. Full suites for both files.**
- [ ] **Step 6: Commit** — `feat(groups): channels declare the community root as NIP-29 parent`.

---

### Task A3: Admins are pre-joined — admin fan-out at channel creation

**Files:**
- Modify: `src/lib/components/community/channels/ChannelCreateWizard.svelte` (post-create hook)
- Modify: `src/lib/components/community/channels/PrivateChannelsView.svelte` (pass admin pubkeys prop)
- Test: `src/lib/components/__tests__/ChannelCreateWizard.test.js`

**Interfaces:**
- Consumes: `putUserOn(pointer, pubkey, roles, user)` from `src/lib/groups/roster-fanout.js`; `fanOut(targets, keyFn, opFn)` aggregate from the same module; root roster admins from the parent view's `useRootRoster` (already instantiated in the community layout — `PrivateChannelsView` receives/derives `roster`).
- Produces: new wizard prop `adminPubkeys: string[]` (default `[]`) — root-group admins (hex). After `createGroupOnRelay` succeeds in NIP-29 mode, the wizard put-users each `adminPubkeys` entry except the creator with role `['admin']`, best-effort (`fanOut` + `area_members_fanout_partial` toast on partial failure — same pattern as `MembershipPane.fanOutNewMember`).

- [ ] **Step 1: Failing wizard test** — with `adminPubkeys: [ME, OTHER_ADMIN]` and creator `ME`: after create, exactly one 9000 put-user for `OTHER_ADMIN` with tags containing `['p', OTHER_ADMIN, 'admin']` and `['h', <new channel id>]` is published (capture via the existing publish spy); none for `ME` (relay already added the creator as admin).
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** — after the pointer publish in the wizard's NIP-29 branch:

```javascript
const others = adminPubkeys.filter((a) => a !== user.pubkey);
if (others.length > 0) {
  const aggregate = await fanOut(others, (a) => a,
    (a) => putUserOn({ id, relay }, a, ['admin'], user));
  if (aggregate.failed.length > 0) showToast(m.area_members_fanout_partial({ failed: aggregate.failed.length, total: others.length }), 'warning');
}
```

- [ ] **Step 4: Wire the prop** in `PrivateChannelsView.svelte`: `<ChannelCreateWizard … adminPubkeys={rootRoster.admins.map((a) => a.pubkey)} />` (use whatever roster accessor the view already holds; if it has none, lift it from the layout the same way `MembersView` does).
- [ ] **Step 5: Run wizard suite → green. Commit** — `feat(groups): pre-join root admins into new channels`.

---

### Task A4: Retire the members-tier blanket fan-out; reconcile admins instead

Members now enter channels by their own 9021 (instant on pyramid-edufeed R2, pending queue elsewhere). Blanket auto-add of every member into members-tier channels is removed; the reconcile machinery keeps admins present everywhere.

**Files:**
- Modify: `src/lib/groups/area-members.js` (`reconcilePlan` → admins), `src/lib/groups/roster-reconcile.svelte.js`
- Modify: `src/lib/components/community/settings/MembershipPane.svelte` (`fanOutNewMember` → root-only), `src/lib/components/community/settings/JoinRequestsPanel.svelte` (approve = root + specifically-asked channel only)
- Test: `src/lib/__tests__/area-members.test.js`, `src/lib/components/__tests__/MembershipPane.test.js`, `src/lib/components/__tests__/JoinRequestsPanel`-covering specs (currently inside MembershipPane/MembersView tests)

**Interfaces:**
- Produces: `reconcilePlan({ admins, pointers, membersByKey, adminsByKey })` — input switches from `members` to `admins` (array of hex pubkeys, the root group's admins); returns `[{pointer, pubkey}]` for every admin missing from an **answered** channel roster (any tier, since admins belong everywhere). `fanOutPlan` keeps its signature but is now called ONLY with a specifically-asked channel (approve flow) — no blanket stufe2 sweep.
- Consumes: `useRosterReconcile` keeps its once-per-community+account ledger; the put-user it issues now carries roles `['admin']`.

- [ ] **Step 1: Failing unit tests** in `area-members.test.js`:

```javascript
it('reconcilePlan targets admins missing from ANY answered channel, with no member sweep', () => {
  const plan = reconcilePlan({
    admins: [ADMIN_A],
    pointers: [chMembers, chInvited],           // both answered below
    membersByKey: { [key(chMembers)]: new Set(), [key(chInvited)]: new Set([ADMIN_A]) },
    adminsByKey: { [key(chMembers)]: [], [key(chInvited)]: [] }
  });
  expect(plan).toEqual([{ pointer: chMembers, pubkey: ADMIN_A }]);
});
```

- [ ] **Step 2: Run, verify FAIL** (current implementation sweeps members over members-tier pointers).
- [ ] **Step 3: Implement** `reconcilePlan` on admins over ALL pointers (drop the `stufe2Pointers` members-tier restriction for this path; keep skipping unanswered rosters). Update `roster-reconcile.svelte.js` to feed `getRootRoster().admins.map(a => a.pubkey)` and to put-user with `['admin']`.
- [ ] **Step 4: Trim the approve/add flows:** `MembershipPane.fanOutNewMember` → root put-user only (delete its stufe2 fan-out; keep the function for `GroupMembersModal.onMemberAdded` so the roster refreshes); `JoinRequestsPanel.approveRequest` → keep root put-user + the `row.groupId` specifically-asked channel, delete the `fanOutPlan` stufe2 sweep.
- [ ] **Step 5: Update the affected component specs** (MembershipPane/MembersView: assertions about members-tier put-users are inverted — assert NO channel put-user beyond the asked one). Run the four test files → green.
- [ ] **Step 6: Run the full component suite** (`pnpm run test:component`) — known-flaky inbox quartet failures under load are pre-existing; verify anything else in isolation before accepting.
- [ ] **Step 7: Commit** — `feat(groups): members join channels themselves; reconcile keeps admins everywhere`.

---

### Task A5: Instant-join UX — roster refresh after a successful 9021

On pyramid, an accepted 9021 is followed within ~100ms by the relay's put-user; the composer should unlock without a reload.

**Files:**
- Modify: `src/lib/components/groups/GroupChat.svelte` (`join()`)
- Test: `src/lib/components/__tests__/GroupChat.test.js`

**Interfaces:**
- Consumes: the component's existing roster request effect (re-runs on its trigger counter) and `joinRequestedNow` state.

- [ ] **Step 1: Failing component test** — on the open `openchat` fixture group: click join; the mock relay accepts the 9021 AND starts serving a 39002 members list including ME (and a 9000 put-user for ME); assert the composer (`ChatComposer` stub) appears without remount — i.e. the roster is re-requested after join success.
- [ ] **Step 2: Run, verify FAIL** (today the roster query only re-runs on auth retry / pointer change).
- [ ] **Step 3: Implement** — after the join publish resolves OK, bump the roster-request trigger (`rosterSeq++` style, matching the file's existing trigger-counter pattern) once immediately and once after a 1500ms timeout (cleared on destroy) to catch slower relays.
- [ ] **Step 4: Run GroupChat suite → green (watch the disclosure-line counting specs — they count REQ frames; update expected counts).**
- [ ] **Step 5: Commit** — `fix(groups): unlock composer right after an accepted self-join`.

---

### Task A6: Invite an npub — single-use code over NIP-17 DM, consent on arrival

**Files:**
- Create: `src/lib/groups/invite-message.js` (+ test `src/lib/__tests__/invite-message.test.js`)
- Create: `src/lib/groups/relay-self.js` (+ test `src/lib/__tests__/relay-self.test.js`)
- Modify: `src/lib/components/groups/GroupMembersModal.svelte` (second action beside direct-add)
- Modify: `src/lib/components/community/views/CommunityProfileHero.svelte` (prefill from `?join=`)
- Test: `src/lib/components/__tests__/GroupMembersModal.test.js`, `CommunityProfileHero.test.js`
- i18n: `messages/de.json` + `messages/en.json`

**Interfaces:**
- Produces:
  - `buildGroupInviteMessage({ communityName, joinUrl, naddr })` → plain string: one greeting sentence (paraglide `group_invite_dm_body({name})`), the app join URL, and — when `naddr` is present — the `nostr:naddr…?invite=<code>` identifier on its own line (cross-client, per NIP-29).
  - `fetchRelaySelf(relayUrl)` → `Promise<string|null>`: GET the NIP-11 doc (`https://` + host/path, `Accept: application/nostr+json`, 5s timeout), return the `self` hex; module-level cache per normalized URL; null on any failure (the DM then simply omits the naddr line).
  - Join URL shape: `${location.origin}/c/${npub}?view=channels&join=${code}`.
- Consumes: `generateInviteCode`, `buildCreateInviteTemplate`, `publishToGroupRelay` (group-management.js); `sendWrappedDm(recipients, content)` (src/lib/services/wrapped-dm.js); `nip19.naddrEncode({ kind: 39000, pubkey: self, identifier: groupId, relays: [relay] })` from nostr-tools/nip19 (encode only — no relay comm).
- Flow (all in GroupMembersModal's new "Per DM einladen" pane): npub input → decode → mint code (9009 to the ROOT group — root is closed, so `create-invite` is legal) → `sendWrappedDm([hexPubkey], message)` → success toast `group_invite_dm_sent`. The DM is user-initiated per click; failures toast with reason.

- [ ] **Step 1: Failing unit tests** — `buildGroupInviteMessage` includes the URL and (when naddr given) a `nostr:naddr` line containing `?invite=`; `fetchRelaySelf` parses `{self}` from a mocked fetch, caches (second call = no fetch), null on 500/timeout.
- [ ] **Step 2: Run, verify FAIL → implement both helpers → green.**
- [ ] **Step 3: Failing modal test** — fill npub, click send: a 9009 with a `code` tag goes to the root relay AND `sendWrappedDm` (mocked) receives `[hex]` and a string containing that same code. Invalid npub → inline error, nothing published.
- [ ] **Step 4: Implement the modal pane** (radio or two buttons: "Direkt hinzufügen" = existing putUser; "Per DM einladen" = this flow). Buttons `btn` inside the modal per the Buttons rule. i18n keys: `group_invite_dm_action`, `group_invite_dm_body`, `group_invite_dm_sent`, `group_invite_dm_failed` (de+en, and in the test's paraglide mock).
- [ ] **Step 5: Failing hero test** — mount with page URL `?join=CODE123`: the invite-code modal is open and the input prefilled with `CODE123`; submitting sends the 9021 with `['code','CODE123']` (accept = the user's explicit click — consent).
- [ ] **Step 6: Implement** — in the hero, an `$effect` reading `$page.url.searchParams.get('join')` once: set `inviteCode`, open `showInviteInput`, then strip the param via `replaceState` so a reload doesn't re-open.
- [ ] **Step 7: Run all four test files + `pnpm run check` → green. Commit** — `feat(groups): npub invites as consent DMs with single-use codes`.

---

### Task A7: Re-issue kind-9002 when the 10222 profile changes

**Files:**
- Create: `src/lib/groups/sync-group-metadata.js` (+ test `src/lib/__tests__/sync-group-metadata.test.js`)
- Modify: `src/lib/components/community/settings/CommunityBasicsForm.svelte` (after successful `publishCommunityUpdate`)
- Test: extend `src/lib/components/__tests__/CommunityBasicsForm.test.js` if present, else the unit test carries the logic

**Interfaces:**
- Produces: `syncRootGroupMetadata({ pointer, profile, signerUser })` → builds `buildEditGroupMetadataTemplate(pointer.id, { name: profile.name, about: profile.about, picture: profile.picture, isPublic: true, isOpen: false })` and publishes via `publishToGroupRelay(pool.relay(pointer.relay), template, signerUser)`. Returns `{ok: boolean, error?: string}`; never throws (best-effort — the 10222 save already succeeded).
  - **Flag caution:** the 9002 must not accidentally flip `closed`/`private` — read the group's current 39000 first (`confirmGroupMetadata(relayConn, pointer.id)`) and mirror its `private`/`closed` presence into `isPublic`/`isOpen`; only name/about/picture change.
- Consumes: `getMembershipPointer` (src/lib/groups/community-membership.js) for the root pointer; the form's already-active user (the signer must be a group admin — the human creator and/or the community seat are; if the relay refuses, surface the warning toast `community_group_metadata_sync_failed`, do not block the save).

- [ ] **Step 1: Failing unit test** — with a mocked relay conn whose `request` serves a 39000 carrying `['private']` + `['closed']`: `syncRootGroupMetadata` publishes a 9002 whose tags include `['name','New']`, `['about','…']`, `['picture','…']`, `['private']`, `['closed']`, `['restricted']`; a relay error yields `{ok:false}` without throwing.
- [ ] **Step 2: Run, verify FAIL → implement → green.**
- [ ] **Step 3: Wire the form:** after `publishCommunityUpdate` resolves, if `getMembershipPointer(communityEvent)` exists → `const r = await syncRootGroupMetadata(...); if (!r.ok) showToast(m.community_group_metadata_sync_failed(), 'warning')`. i18n key de+en.
- [ ] **Step 4: Run the form's test file + unit test → green. Commit** — `feat(groups): 10222 profile edits propagate to the NIP-29 group metadata`.

---

### Task A8: Default relay switch, friendly whitelist error, stale-signature retry

**Files:**
- Modify: `.env.example` (or `.env.template` — whichever the repo tracks; plus a note in `CLAUDE.md`'s config table if `GROUPS_RELAYS` is missing there)
- Modify: `src/lib/groups/group-management.js` (`publishToGroupRelay`)
- Modify: the flip-to-moderated error surface (`CommunityTypeSection`/`AccessTierEditor` — wherever `provisionRootGroup` errors are caught; locate via `grep -rn provisionRootGroup src/lib/components`)
- Test: `src/lib/__tests__/group-management*.test.js`

**Interfaces:**
- Produces:
  - `isRelayMembershipRequired(error)` in group-management.js: matches `/only members of this relay can create a group/i` — the flip flow shows `community_groups_relay_membership_required` (de: "Dieser Gruppen-Relay nimmt nur freigeschaltete Konten an. Bitte beim Betreiber freischalten lassen.") instead of the raw reason.
  - Stale-moderation retry inside `publishToGroupRelay`: when the relay answers `/too old/i` (pyramid's 60s guard — NIP-46 bunker approvals can exceed it), re-stamp `created_at`, re-sign ONCE, republish.
- `.env.example`: `GROUPS_RELAYS=wss://groups.edufeed.org` with a comment that community founders must be whitelisted on the pyramid.

- [ ] **Step 1: Failing unit tests** — (a) `isRelayMembershipRequired(new Error('restricted: only members of this relay can create a group'))` is true; (b) a mock relay that rejects the first publish with `moderation action is too old (older than 1 minute ago)` and accepts the second: `publishToGroupRelay` resolves, and the second event's `created_at` ≥ the first's.
- [ ] **Step 2: Run, verify FAIL → implement → green.**
- [ ] **Step 3: Wire the friendly error** in the flip flow's catch; i18n key de+en; update `.env.example` + CLAUDE.md config table row.
- [ ] **Step 4: `pnpm run check` + related suites green. Commit** — `feat(groups): groups.edufeed.org default + pyramid error/staleness handling`.

---

## Self-Review notes

- Stories coverage: S2 → A1; S3 join-by-decision → A4+A5 (+relay R2), admins pre-joined → A3+A4, accept-invitation → A6; S1 invite npubs + notification → A6, metadata in Armada → A7 (+relay R3), relay default → A8. Beitrittsanfragen survive unchanged (JoinRequestsPanel keeps aggregating; pyramid stores pending after relay R1).
- Type consistency: `reconcilePlan` input renamed `members`→`admins` (Task A4 updates the only caller `roster-reconcile.svelte.js` and the tests in the same task). `fanOutPlan` signature unchanged.
- Degradation: every 9021-based flow works on groups.0xchat.com today (stored/pending) and becomes instant on the patched fork — no ordering dependency between the plans.
