# Task 11 report: MembersView role chips + manager-reactivity resolution

## Status

DONE. Both parts implemented, tested, and committed in one commit.

## Commit

`a3e0e0bd3ad08a1a3cf734ac708367cb7e506fba` — `feat(community): member role chips + manager-reactivity resolution`

## Part A — MembersView role chips

`src/lib/components/community/views/MembersView.svelte`: for MODERATED
communities (`deriveCommunityType`), member rows now show role chips
(`data-testid="member-role-chip"`) sourced from the root-group NIP-29
roster via a component-init `useRootRoster(() => communikeyEvent)`
instance — rosters are public, so this is visitor-visible like the rest
of the list. Roles come from the matching `roster.admins` entry; a bare
admin (empty `roles` array) falls back to a single `'admin'` chip. Chips
render in both branches (the "only owner" early-return branch and the
main member grid). Open/closed communities are unaffected — `getRoleChips`
short-circuits to `[]` when `deriveCommunityType !== 'moderated'`, so no
chip markup is emitted there even if a roster happens to have data. Also
added `data-testid="member-row"` + `data-pubkey` to grid rows for test
addressability.

## Part B — manager-reactivity investigation (implemented, not deferred)

Checked `applesauce-accounts`' `AccountManager`: it exposes `accounts$`/
`active$` as real `BehaviorSubject`s (confirmed via `manager.d.ts` and by
the fact `accounts.svelte.js` already subscribes to both in several
places). Since a cheap signal exists, implemented the bridge rather than
document-and-close.

- `src/lib/stores/accounts.svelte.js`: subscribes to `manager.accounts$`
  and `manager.active$` once at module init, bumping
  `manager.accountsVersion` — a plain counter **property attached directly
  to the already-`$state` `manager` object** (not a separate module
  export). This was a deliberate revision from an initial separate-export
  design: Svelte disallows exporting a reassigned `$state` primitive
  (`state_invalid_export`), and a separate exported getter function broke
  ~90 existing test files that mock `$lib/stores/accounts.svelte` with a
  `manager: {...}` object but no new export (vi.mock throws "No export
  defined on the mock" on *any* read of a missing named export, not just
  on call). Attaching the counter as a plain property on `manager` means
  existing mocks that already provide `manager: { getAccountForPubkey }`
  just read `undefined` for the new field — a normal, silent JS property
  read, not a module-shape violation.
- `src/lib/helpers/community-signer.js`: `getCommunitySigner` does a
  no-op `void manager.accountsVersion` read, registering the dependency so
  `$derived.by` callers (all of `getCommunitySigner`'s call sites already
  use `$derived.by` per the Plan 3 convention) now recompute on a
  mid-session account switch/import/remove. `isCommunityOwner` inherits
  this since it delegates to `getCommunitySigner`. Comment block rewritten
  from "treat as incidental" to document the actual mechanism.
- Docs: `docs/superpowers/specs/2026-08-12-groups-architecture-design.md`'s
  "`manager` reactivity signal" deferred-item bullet marked
  **RESOLVED (Plan 5 Task 11)** with a summary of the fix.

### Covering tests

- `src/lib/__tests__/accounts-version-bridge.test.js` (node env, imports
  the REAL `accounts.svelte.js` — safe because `initializeAccountPersistence`
  gates its window/localStorage side effects behind `typeof window`, which
  is undefined in node): proves `manager.accountsVersion` increments after
  a manual `manager.accounts$.next(...)` / `manager.active$.next(...)`.
- `src/lib/__tests__/community-signer-reactivity.test.svelte.js` (jsdom,
  `$effect.root` + `$derived.by` + `flushSync`, mirroring the existing
  `image-license-hook.test.svelte.js` pattern): mocks
  `$lib/stores/accounts.svelte` with a `manager.accountsVersion` getter
  backed by a real local `$state`, wraps `getCommunitySigner` in
  `$derived.by`, bumps the mock counter, and asserts the derived value
  flips from `null` to the signer. Verified this test is meaningful by
  temporarily disabling the `void manager.accountsVersion` read in
  `community-signer.js` — the test failed as expected, then restored.

## Test summary (actual numbers)

- New/extended suites run together: 5 files, 19 tests passed
  (`MembersView.test.js` 3, `community-signer.test.js` 2,
  `accounts-version-bridge.test.js` 2, `community-signer-reactivity.test.svelte.js` 1,
  `accounts.queue.test.js` 11).
- Wider regression sweep for every component that imports
  `community-signer.js` (`SettingsView`, `MembershipPane`,
  `PrivateChannelsView` × 5 test files, `AreaAttachModal`,
  `ChannelCreateWizard`, `GroupChat` × 2, `FormResponses`,
  `FormLinkManager`, `ContentNavSidebar`, `CommunityProfileHero`): 20 files,
  166 tests passed.
- Full `src/lib/components/__tests__`: 171 files, 1345 tests passed (1
  unrelated pre-existing unhandled-rejection isolation artifact in
  `GlobalFAB.test.js`, doesn't touch accounts.svelte/community-signer,
  test itself still passed).
- Full `src/lib/__tests__`: 378/383 files passed, 4920/4924 tests passed.
  Failures are the two pre-existing/known issues from memory and the
  Task 12 brief itself: `pomegranate-service.test.js` (collection failure,
  `@noble/hashes/utils.js` resolution, pre-existing) and 4 inbox tests
  that time out only under full-suite parallel load — reran all 4 inbox
  files in isolation and they pass (30/30 tests). Neither relates to this
  change.
- `pnpm run check`: 0 errors, 7 pre-existing warnings (all
  `state_referenced_locally` in files this task didn't touch).
- `pnpm run lint`: clean (fixed one pre-existing-pattern-triggered issue —
  `eslint-plugin-svelte`'s `svelte/prefer-svelte-reactivity` flagged a
  plain `Map` in the new `.test.svelte.js` file; switched to `SvelteMap`).

## Concerns

None outstanding. One thing worth flagging for Task 12's closing docs
pass: the design doc's separate "MembersView role-tiered grouping" item
(Plan 3 item 7 — `getMembers` returns the full roster rather than just
role-holders for section grouping) is intentionally **not** touched by
this task; Part A only decorates rows the existing owner+gated-section
member list already renders, it does not merge the full NIP-29 roster
into `memberData.allMembers`. Task 12's own checklist already anticipates
this ("MembersView role-tier decision if partially taken").

---

## Fix pass (post-review): Part B was a placebo, plus a role-chip dedup gap

A task review of the first commit (`a3e0e0bd`) found the Part B bridge
delivered **zero real reactivity** and that its covering test only
validated a mock, not the mechanism, plus a pre-existing dedup gap in the
role-chip rendering this task added. All three are fixed here.

**Commit:** `<filled in below>` — `fix(accounts): real reactivity bridge on proxied state + role-chip dedup`

### Critical 1 — the bridge was a placebo (root cause confirmed, fixed)

`manager.accountsVersion++` on `export const manager = $state(new
AccountManager())` was an **untracked, ordinary JS mutation**. Read
`node_modules/.pnpm/svelte@5.55.4/.../internal/client/proxy.js` directly
to confirm: `proxy(value)` bails and returns `value` unchanged unless
`get_prototype_of(value)` is exactly `Object.prototype` or
`Array.prototype` (lines 46–50). `new AccountManager()`'s prototype is
`AccountManager.prototype`, so `$state(new AccountManager())` never
proxies it — `manager` is a plain object, and writes to any property on
it (old or new) go untracked by Svelte's reactivity graph. The old
design's own covering test never caught this because it mocked `manager`
as a plain `{...}` — a real proxied-or-not question the mock can't answer
either way.

**Fix:** moved the counter to `accountsMeta` — `export const accountsMeta
= $state({ version: 0 })`, a genuine object **literal**, which Svelte's
`proxy()` DOES wrap (prototype is `Object.prototype`). `accounts.svelte.js`
bumps `accountsMeta.version` from the same `accounts$`/`active$`
subscriptions; `community-signer.js` reads `accountsMeta.version` (no-op)
instead of `manager.accountsVersion`.

This introduces one new named export (`accountsMeta`) that
`community-signer.js` now imports. Same class of risk flagged in the
original Part B write-up applies here too: any test file that mocks
`$lib/stores/accounts.svelte` AND renders a component on a code path that
calls `getCommunitySigner`/`isCommunityOwner` needs `accountsMeta` in its
mock, or vitest throws "No accountsMeta export is defined on the mock" the
moment the read happens (this is a lazy check — only files that actually
exercise the call path break; a full-suite run made this list exact
rather than guessed). Fixed mocks in:
`AreaAttachModal.test.svelte.js`, `ChannelCreateWizard.test.js` (both
`'$lib/stores/accounts.svelte'` and `'$lib/stores/accounts.svelte.js'`
mocks — this file was the one place in the suite mocking both specifiers
separately), `ContentNavSidebar.group-channels.test.svelte.js`,
`PrivateChannelsView.test.js`, `PrivateChannelsView.management.test.svelte.js`,
`PrivateChannelsView.group-channels.test.svelte.js`,
`PrivateChannelsView.groups.test.js`,
`PrivateChannelsView.shared-selection.test.svelte.js`, `SettingsView.test.js`,
and (found only by running the FULL `src/lib/__tests__` sweep, not the
component-suite consumer list) `pin-list-service.test.js` — `pin-list-
service.js` is also a `getCommunitySigner`/`isCommunityOwner` consumer,
missed in the original Part B risk assessment.

### Critical 2 — the covering test only proved a mock reacts (root cause found, rewritten)

`community-signer-reactivity.test.svelte.js` now imports the REAL
`accounts.svelte.js` module (no `vi.mock` of it at all) and drives the
real, public `manager.addAccount({...})` API (which pushes onto the real
`accounts$` `BehaviorSubject` — confirmed by reading
`applesauce-accounts/dist/manager.js`), asserting a
`$derived.by(() => isCommunityOwner(pk))` flips `false` → `true`.

Getting this working surfaced two real findings, both left as comments
in the test file so they aren't rediscovered the hard way:

1. **`$effect` bodies inside `$effect.root` did not fire under
   `@vitest-environment node`** — verified with a throwaway repro run
   three different ways; `$derived.by`/`flushSync()` alone are
   environment-agnostic (per `accounts-version-bridge.test.js`, which
   stays in node), but a plain `$effect` needs jsdom's globals to actually
   flush here. Switched this file to jsdom, matching the existing
   `image-license-hook.test.svelte.js` precedent.
2. **A self-inflicted false-pragma bug**, found only after the jsdom
   switch still failed identically: the file's leading doc comment,
   describing the node-environment experiment in prose, literally
   contained the substring `@vitest-environment node` (inside backticks,
   meant as inline code) BEFORE the real `@vitest-environment jsdom`
   pragma at the end of the same comment block. Vitest's pragma scanner
   matched the FIRST occurrence, silently running the file under node
   regardless of the real pragma — reproduced byte-for-byte (identical
   test body, only the comment differed) and fixed by rewording the prose
   to never contain a second `@vitest-environment` string, with an
   explicit warning left in the comment for future editors.

Verified meaningful (not vacuously green) by temporarily commenting out
`community-signer.js`'s `void accountsMeta.version;` read — the test
failed (`false` when `true` was expected) — then restored.

### Important 3 — role-chip dedup (CLAUDE.md rule, was missed originally)

`admin.roles` comes straight off a kind 39001 event's tags — untrusted
network input a malformed/misbehaving relay can repeat — feeding a keyed
`{#each admin.roles as role (role)}` unguarded, which crashes the whole
page on a duplicate (`each_key_duplicate`, the exact CLAUDE.md "Keyed
{#each} over Tag-Derived Data Must Be Deduped" rule). Fixed with
`unique()` from `$lib/helpers/unique.js` in both places using this
pattern:

- `MembersView.svelte`'s `getRoleChips()` — the one this task added.
- `GroupMembersModal.svelte:171` (now 172) — a **pre-existing** instance
  of the same bug, in scope per the review since this fix pass was
  already touching the rule.

Verified both are meaningful, not decorative: reverted each `unique()`
call temporarily and confirmed the covering test crashes with
`https://svelte.dev/e/each_key_duplicate` (not just a wrong assertion),
then restored.

**New covering tests:**
- `MembersView.test.js` — "a malformed roster with a duplicated role
  renders one chip, not a crash".
- `GroupMembersModal.test.js` — "a malformed 39001 with a duplicated role
  renders one chip, not a crash".

### Test summary (actual numbers, this fix pass)

- New/rewritten covering tests together: 6 files, 33 tests passed
  (`MembersView.test.js` 4, `GroupMembersModal.test.js` 13,
  `community-signer.test.js` 2, `accounts-version-bridge.test.js` 2,
  `community-signer-reactivity.test.svelte.js` 1, `accounts.queue.test.js` 11).
- Community-signer consumer sweep (same 15 files as the original pass,
  re-run against the `accountsMeta` design): 15 files, 147 tests passed.
- Full `src/lib/components/__tests__`: 171 files, 1347 tests passed (2
  more than the original pass — the two new dedup tests; same unrelated
  pre-existing `GlobalFAB.test.js` teardown-ordering artifact as before,
  test itself still passed).
- Full `src/lib/__tests__`: 382/383 files passed, all 4924 tests passed
  (first run surfaced the missed `pin-list-service.test.js` mock, fixed,
  re-run clean). Only remaining failure is the pre-existing, unrelated
  `pomegranate-service.test.js` collection error (`@noble/hashes/utils.js`
  resolution) — no inbox-test flakiness recurred this run.
- `pnpm run check`: 0 errors, 7 pre-existing warnings (unchanged from
  before this fix pass, all in files this task never touched).
- `pnpm run lint`: clean, exit 0.

### Reactivity bridge: where it lives and why it's genuinely reactive

The counter now lives in `accountsMeta` (`$state({ version: 0 })`, an
object **literal** exported from `accounts.svelte.js`), not on `manager`
— because Svelte's `$state()` only deep-proxies values whose prototype is
`Object.prototype`/`Array.prototype`, and `manager` (`$state(new
AccountManager())`) is a class instance that fails that check and is
therefore never proxied, so writes to it are invisible to `$derived`;
`accountsMeta`'s literal-object prototype passes the check, so
`accountsMeta.version++` is a real, tracked write that `$derived.by`
consumers (via a no-op read in `community-signer.js`) genuinely
recompute against — proven against the unmocked, real
`accounts.svelte.js` module and a real `AccountManager.addAccount(...)`
call in `community-signer-reactivity.test.svelte.js`.
