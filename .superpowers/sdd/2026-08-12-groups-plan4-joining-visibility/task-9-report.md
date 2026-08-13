# Task 9: Full verification, live relay probe, docs sync — Report

Branch: `feat/community-group-pointer`, worktree
`/home/laoc/coding/edufeed/edufeed-app/.worktrees/group-pointer`

## Step 1: Full suite

### `pnpm test`

Full parallel run: **15 failed | 611 passed (626) files**, **34 failed |
6703 passed (6737) tests**, exit 1.

One genuine pre-existing failure, matching the brief's expectation exactly:

- `src/lib/__tests__/pomegranate-service.test.js` — collection error,
  `Cannot find package '@noble/hashes/utils.js'`. Environment/dependency
  issue (module-resolution mismatch for `@noble/hashes` v2's subpath
  exports), not a plan-4 regression — pre-existing, fails on `dev` too. Its
  collection error also destabilizes `GlobalFAB.test.js`'s run (Vitest
  attributes an error there "while it was running" though not thrown in
  that file) — consistent with the known-flaky pairing already documented
  in project memory.

The other 14 failing files/33 failing tests were **all** re-run in isolation
(two batched `vitest run <files...>` invocations, no full-suite parallelism)
and **passed 100%** (5 files/47 tests, then 9 files/45 tests — 92 tests
total, 0 failures):

- `src/lib/components/membership/__tests__/MembershipCard.test.js`
- `src/lib/components/__tests__/AdminMembershipRoute.test.js`
- `src/lib/components/__tests__/ChannelMembersModal.test.js`
- `src/lib/components/__tests__/SettingsView.test.js`
- `src/lib/components/__tests__/AreaAttachModal.test.svelte.js`
- `src/lib/components/__tests__/LicensedFileInput.metaclean.test.js`
- `src/lib/components/__tests__/LicensedImageInput.metaclean.test.js`
- `src/lib/components/__tests__/LicensedImageInput.test.svelte.js`
- `src/lib/components/__tests__/FormBuilder.test.js`
- `src/lib/components/__tests__/FormBuilder.sections.test.js`
- `src/lib/components/educational/__tests__/CreatorInput.selfadd.test.js`
- `src/lib/components/educational/__tests__/CreatorInput.orcid.test.js`
- `src/lib/components/educational/__tests__/CreatorInput.pubkey.test.js`
- `src/lib/components/__tests__/ImageLicenseOverlay.test.svelte.js`

This confirms full-suite CPU/resource contention (the same phenomenon
project memory already documents for inbox/DM/oer/GlobalFAB/
concord-notifications, here spreading to a broader set of heavy jsdom
component files under this run's load), not real regressions. None of the
14 files are plan-4 domain code except MembershipCard/AdminMembershipRoute/
ChannelMembersModal/SettingsView/AreaAttachModal, all of which are
plan-4-adjacent and all green in isolation.

**Conclusion: suite is clean modulo the one pre-existing, dev-reproducible
pomegranate-service.test.js collection failure.**

### `pnpm run check`

`COMPLETED 7633 FILES 0 ERRORS 7 WARNINGS 7 FILES_WITH_PROBLEMS`, exit 0.
Warnings are all pre-existing `state_referenced_locally` notices in test
fixtures (`GroupChat.svelte`, `HostChannelSidebarHost.svelte`,
`AuthedImageHost.svelte`, `ParticipantsEditorHost.svelte`,
`RelationAdapterHost.svelte`), not plan-4 code.

### `pnpm run lint`

`prettier --check .` and `eslint .` both clean, exit 0.

## Step 2: Live relay probe

Script: `nip29-join-probe.mjs` in this session's scratchpad (NOT committed).
Relay: `wss://groups.0xchat.com` (first entry of `GROUPS_RELAYS` in the
worktree `.env`). Two throwaway identities via `nostr-tools`' `pure.js`
(key generation/signing only); raw `WebSocket` for all relay traffic
(house rule: no `nostr-tools` `SimplePool`), with NIP-42 AUTH handling
(one attempt per challenge, matching `src/lib/groups/relay-auth.js`'s
house rule) — though this relay never actually demanded AUTH for any of
the moderation-kind publishes in this run; it sent a proactive `AUTH`
challenge on connect but accepted every write unauthenticated.

Full transcript (also captured in scratchpad `join-probe-transcript.txt`):

```
# NIP-29 moderated-join probe (Task 9, brief Step 2)
relay: wss://groups.0xchat.com
groupId: 2b696745ebe31bb6
A (founder) pubkey: 6ef3e0898707bcd03c1075315fe9e4b00f4d57016ac754ce66ce0278779f159f
B (joiner) pubkey: 05a5d4a7c56c4a1c0f81df7e6c75cbc01c4855c40646fe7fe7672a407603f829
invite code: 63KuE4nSZGcF

--- [A] connected as 6ef3e08... ---
[A] << ["AUTH","6d42c692a243b910"]
[B] << ["AUTH","a13f37a141b6f6d2"]
--- [B] connected as 05a5d4a...  ---

--- [A] publishing 9007 create-group (closed+restricted metadata) ---
[A] >> ["EVENT",{"kind":9007,...,"tags":[["h","2b696745ebe31bb6"],["name","task9-probe"],["public"],["closed"],["restricted"]],...}]
[A] << ["OK","699896...",true,""]
create-group OK result: {"ok":true,"message":""}

--- [A] publishing 9002 edit-metadata (same tags) ---
[A] << ["OK","1457ae...",true,""]
edit-metadata OK result: {"ok":true,"message":""}

--- [A] publishing 9009 create-invite (code=63KuE4nSZGcF) ---
[A] << ["OK","de1c17...",false,"blocked: received event kind 9009 not allowed"]
create-invite OK result: {"ok":false,"message":"blocked: received event kind 9009 not allowed"}

=== FINDING TARGET 1: bare 9021 on a closed group ===
--- [B] publishing 9021 bare join (no code) ---
[B] << ["OK","7287f2...",true,""]
bare 9021 OK result (VERBATIM): {"ok":true,"message":""}
39002 members after bare 9021: ["6ef3e089..."]   (A only)
B listed as member after bare 9021: false

=== FINDING TARGET 2: 9009-code 9021 on a closed group ===
--- [B] publishing 9021 join with invite code (code=63KuE4nSZGcF) ---
[B] << ["OK","3ae0ea...",true,""]
coded 9021 OK result (VERBATIM): {"ok":true,"message":""}
39002 members after coded 9021: ["6ef3e089..."]   (still A only)
B listed as member after coded 9021: false

--- A: 9000 put-user B role=probe ---
[A] << ["OK","afd1a9...",true,""]
put-user OK result: {"ok":true,"message":""}
39001 admins tags: [["d","2b696745..."],["p","6ef3e089...","king"],["p","05a5d4a7...","probe"]]
39002 members: ["6ef3e089...","05a5d4a7..."]
B's role entry in 39001: ["p","05a5d4a7...","probe"]
B listed in 39002 members: true

--- A: 9008 delete-group cleanup ---
delete-group cleanup did not confirm: timeout waiting for OK (group may still exist on relay)

=== SUMMARY ===
Finding 1 — bare 9021 on closed group: ok=true, message="", membership granted=false
Finding 2 — 9009-code 9021 on closed group: ok=true, message="", membership granted=false
```

Cleanup was verified separately: a follow-up `REQ` for
`{kinds:[39000,39001,39002], "#d":["2b696745ebe31bb6"]}` after the 9008
returned **zero events** — the group is actually gone despite the OK
timing out (this relay's OK for 9008 is slow/unreliable but the delete
itself lands; matches a prior probe run's finding for this same relay).

The 9009 rejection was independently re-verified in a second, isolated
run (fresh group, 3s settle before the invite, no B/join steps at all):
same exact `blocked: received event kind 9009 not allowed` response.
**Deterministic, not a fluke.**

### PROMINENT FINDING 1 — `9009` create-invite is rejected by this relay

`wss://groups.0xchat.com` (this deployment's configured `GROUPS_RELAYS`)
returns `OK false, "blocked: received event kind 9009 not allowed"` for
every `kind:9009` (`create-invite`) publish, confirmed across two
independent create+invite attempts against fresh groups. `9007`, `9002`,
`9000`, `9021`, and `9008` all work as spec'd on this relay — only `9009`
is unsupported.

**Consequence:** the invite-code join flow this plan built —
`MembershipPane`'s "create invite" button (9009 minting, plan-4 task 5) and
the join-with-code path it feeds (task 4) — cannot be exercised end-to-end
against the app's own configured groups relay. The code the app generates
is never actually registered server-side, so a real user pasting that code
into the join button would hit the same "OK true, no membership" outcome
as a bare join (see Finding 2). This is a relay-capability gap, not an
app bug — the app's 9009 template is wire-correct — but it means the
invite-code UX is currently unverifiable/non-functional against the
deployed relay. Any deployment relying on invite-code joins needs to
confirm 9009 support on its own `GROUPS_RELAYS` before shipping that path
to users, or the app needs a fallback UX for relays that reject it.

### PROMINENT FINDING 2 — bare `9021` on a closed group: accepted, not honored

A bare `9021` (no `code` tag) against the closed+restricted group returned
**`OK true`** with an empty message — **not** an `OK false` rejection, and
**not** a silent drop either (the relay does answer). But no membership was
granted: the follow-up `39002` read showed only the founder. This matches
NIP-29's letter ("relays MUST reject the request if the user has not been
added" — but this relay doesn't reject, it acks) more than its intent
diagram. Confirmed identically for the invite-coded 9021 too, since the
code was never validly registered (finding 1) — same `OK true` / no
membership outcome.

**Consequence for Task 4's refusal UX copy:** the moderated join button
cannot treat `OK:true` as proof of membership, nor can it treat `OK:false`
as the failure signal to detect a stuck/pending/rejected join — this relay
never sends `OK:false` for a closed-group join at all. The only reliable
signal is whether a `9000` (put-user) actually arrives / the roster
(`39002`) actually lists the user afterward. UX copy that says something
like "request sent" rather than "joined" for the bare-join case, with the
button only flipping to "member" once the roster confirms it, matches what
this relay actually does. A copy that implies an authoritative yes/no from
the `OK` response would be wrong on this relay.

## Step 3: Docs sync

### `docs/superpowers/specs/2026-08-12-groups-architecture-design.md`

- Marked "New Plan 4 items" #9 and #10 **DONE** with commit refs
  (`7514ac34` for `HomeView` `sectionIsGated`; `29671293` for
  `ChannelInviteSheet` exclusion + `FormResponses` signer fallback), each
  with a short note on what actually shipped.
- Added a **"Plan 4 shipping state"** section summarizing what the whole
  plan (80a737fd..29671293) delivered, plus a **live-relay caveat**
  documenting both prominent probe findings above and pointing at this
  report for the full transcript.
- Added a **"Plan 5 (next)"** section, combining the brief's out-of-scope
  list (two-zone sidebar IA, community-card type badges + 10222 loader,
  NIP-29 e2e relay decision, roster live-updates/isLoading timeout,
  MembersView role-tiered grouping, MembershipPane isAdmin-vs-39001,
  wizard Personen step, handoff UX debt #5/#6/#7/#8/#10/#11, `manager`
  reactivity signal) with a new "Task 9 ledger" subsection recording six
  concrete gaps found while grounding this report, each traced to its
  exact code location:
  - `root-roster.svelte.js` dead-relay `isLoading` (re-confirmation of the
    carried-forward Plan 3 item 6).
  - `ApplicationApprovals.svelte`'s `loadedExtraRelays` `SvelteSet` created
    once at init, never reset on `applicationRef` change.
  - `FormResponses.svelte`'s decrypt loop silently no-ops (no error, no
    value) when `resolveFormResponseDecryptSigners` returns `[]`.
  - `MembershipPane.svelte`'s `handleCopyInviteCode` hardcodes the English
    string `'Clipboard not available'` into the `reason` param of an
    otherwise-translated `m.community_invite_failed()` message.
  - `group-management.js`'s `generateInviteCode` comment claims a
    "52-char alphabet"; the actual alphabet is 54 characters (cosmetic,
    no functional bug).
  - `/forms/respond`'s generic `{:else if error}` branch is a dead end —
    no retry/back affordance, unlike the sibling `alreadyResponded`
    branch.

### `e2e/COVERAGE.md`

- Updated the "Community creation" Partially-Covered row to point at the
  new known-gap entry instead of the now-stale "deferred to Plan 4's
  live-relay E2E" text.
- Added a **"Known gap: moderated group lifecycle (NIP-29)"** paragraph
  under Coverage Gaps: no browser E2E covers the moderated flow because the
  mock-relay fixtures don't speak NIP-29 kinds; closing it needs a NIP-29
  relay in the Playwright docker-compose stack or a mock-relay extension.
  Notes that Task 9's scripted probe covers the protocol path in the
  interim and that it surfaced the relay's `9009` gap.
- Bumped "Last updated" to 2026-08-13.

## Step 4: Commit

Docs committed with `git add -f` (docs/ is gitignored) under
`docs: sync after plan 4 (joining & visibility)`.

## Files touched

- `/home/laoc/coding/edufeed/edufeed-app/.worktrees/group-pointer/docs/superpowers/specs/2026-08-12-groups-architecture-design.md`
- `/home/laoc/coding/edufeed/edufeed-app/.worktrees/group-pointer/e2e/COVERAGE.md`
- `/home/laoc/coding/edufeed/edufeed-app/.worktrees/group-pointer/.superpowers/sdd/2026-08-12-groups-plan4-joining-visibility/task-9-report.md` (this file)

Probe script (NOT committed, scratchpad only):
`/tmp/nix-shell.UbaWiC/claude-1000/-home-laoc-coding-edufeed-edufeed-app/4ab96130-8e33-469e-8bcd-e409fe198420/scratchpad/nip29-join-probe.mjs`
