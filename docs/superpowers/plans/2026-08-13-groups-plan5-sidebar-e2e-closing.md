# Groups Plan 5: Two-Zone Sidebar, E2E & Closing — Implementation Plan (5 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the groups architecture: the design's two-zone community sidebar, the wizard Personen step (with its approvals-reachability prerequisite), community-card type badges, the recorded rulings and UX debt, a NIP-29-capable mock relay enabling the moderated-lifecycle browser E2E, and the docs/NIP promotion to publishable state.

**Architecture:** Pure zone/tab logic extracted and shared (killing the ContentNavSidebar/BottomTabBar duplication), sidebar rows reusing the existing channel-row builder + shared selection store + `?view=channels&channel=` deep link; the E2E relay is an in-process extension of `mock-relay.js` (roster map, replaceable overwrite, live subscription fan-out) started like the existing hanging relay — no new docker service.

**Tech Stack:** SvelteKit + Svelte 5, JavaScript with JSDoc, Vitest, Playwright (nix shell / CHROMIUM_BIN workaround), Node mock relay.

**Spec:** `docs/superpowers/specs/2026-08-12-groups-architecture-design.md` (two-zone section L74-86, Plan-5 list, plan-4 final-review rulings) and `docs/nips/communikey-groups.md`.

**Controller scope decisions (do not re-litigate):**
- **Sidebar zones are desktop-only** (ContentNavSidebar). Mobile (BottomTabBar) keeps the channels TAB — both consume one shared helper for the tab list (DRY). The Kanäle zone REPLACES the channels tab on desktop.
- Kanäle rows keep today's semantics: Concord rows select in-page (navigate to `?view=channels&channel=<id>` — the existing deep-link seeding takes over), NIP-29 rows link out to `/groups/<pointer>`. NIP-29 unread wiring in the sidebar stays OUT of scope (recorded gap).
- Visitor filtering in the Kanäle zone: non-members see only `worldReadable` rows plus one muted lock hint; members/owners see all rows. `unknown` metadata stays fail-closed (🔒) per `channelGlyph`.
- A **Mitglieder** row joins the sidebar footer (the `members` view exists but has no nav row today — design's "Info · Mitglieder" line).
- **E2E relay = mock-relay extension** (deterministic, in-process, port 17004), NOT a docker service. Update BOTH `RELAY_URLS` maps only where applicable (the mock relay is process-managed like the hanging relay — config map only, mirroring `hanging`'s deliberate absence from the setup map).
- Decline dismissal re-keyed by **response id** (plan-4 ruling); stale pubkey-keyed entries become inert (no migration).
- Wizard **Personen step renders for Moderiert only**, skippable; invites executed post-provisioning as sequential root-group put-user fan-out with the HUMAN signer (roster-fanout service). Invite-code minting stays in settings (relay-support caveat documented).
- Manager-reactivity item: **bounded investigation** — if `accounts.svelte.js` exposes a cheap lifecycle signal (applesauce `accounts$`/`active$` observables), bridge one `$state` version counter; otherwise document-and-close. Either outcome closes the item.
- `PLANS/EDUFEED_APP_GRUPPEN_MERGE.md` references in source comments (e.g. `channel-access.js:3`) get repointed to the design doc (the file doesn't exist).

## Global Constraints

- Worktree `/home/laoc/coding/edufeed/edufeed-app/.worktrees/group-pointer`, branch `feat/community-group-pointer`.
- JavaScript with JSDoc only. `pnpm run check` exit 0 after every task. TDD; i18n in BOTH message files; tag-derived keyed `{#each}` through `unique()`/`uniqueBy()`.
- The `/c` layout renders children up to 3×; shared-selection and `vis()`-style scoping patterns apply to components and e2e.
- Deliberately pinned tests that this plan's behavior changes (e.g. `ContentNavSidebar.group-channels.test.svelte.js` pinning the channels TAB) are updated WITH the behavior change, stating so in the report — never silently.
- E2E on this host: `CHROMIUM_BIN=google-chrome E2E_DISABLE_LNA_CHECKS=1` if nix chromium is still broken; run only the specs named per task, never the whole e2e suite mid-plan.
- Commit per task with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; do NOT push.

---

### Task 1: Rulings & polish sweep

**Files:** `src/lib/components/community/settings/ApplicationApprovals.svelte` (decline re-key by `response.id` per the `MembershipApprovalsPanel.svelte:312` precedent + `loadedExtraRelays` reset when `applicationRef.address` changes); `src/lib/components/community/views/CommunityProfileHero.svelte` (pending state keeps the invite-code affordance rendered); `src/routes/forms/[naddr=naddr]/respond/+page.svelte` (submit-time errors — `no-reviewers`, `unresolved`, publish failures — render ABOVE the form, preserving typed input; the pre-submit load-error branch may keep the current shape); `src/lib/components/forms/FormResponses.svelte` (explicit empty-signers branch → decryptErrors set); `src/lib/components/community/settings/MembershipPane.svelte` (clipboard-unavailable reason via a proper i18n key, e.g. `community_invite_clipboard_unavailable`, both files); `src/lib/groups/group-management.js` (alphabet comment 52→54); `src/lib/services/inbox-service.svelte.js` collision-guard TEST (extend the existing inbox suite; cover admin-p-tagged hidden vs community-application visible).
**TDD:** each behavioral fix gets/updates a covering test (decline re-key: declined old response + newer 1069 → visible again; pending+invite affordance; error-above-form preserving input; empty-signers error). Verify the touched suites + check 0 + lint. ONE commit: `fix(community): plan-4 review rulings & polish sweep`.

---

### Task 2: Roster liveness — `isLoading` terminates on empty/dead relays

**Files:** `src/lib/groups/channel-rosters.svelte.js`; test extension `src/lib/__tests__/channel-rosters.svelte.test.js`.
**Behavior:** when a relay's roster request COMPLETES (EOSE or the 8s timeout) without delivering 39001/39002 for a requested id, mark that id resolved-empty: set `membersByKey[key] = membersByKey[key] ?? new Set()` (and leave `adminsByKey` absent) in the request's `complete` handler — `rosterView`'s `isLoading` then terminates (memberSet defined). Stale-while-revalidate semantics preserved (only fill keys still undefined). Downstream effect (no further code): the moderated join lane, dashboard access, and approvals stop spinning forever on dead relays; membership resolves to non-member (fail-closed for gating, correct direction).
**TDD:** extend the jsdom suite — complete-without-events → membersByKey gains an empty Set for the requested key; events-then-complete unchanged; refresh keeps stale values. Verify + `src/lib/__tests__/root-roster.test.js` + check 0. Commit: `fix(groups): roster loading terminates when a relay completes empty`.

---

### Task 3: Approvals reachability (Personen prerequisite)

**Files:** `src/lib/components/community/views/SettingsView.svelte` (the `isOwner && communityType === 'moderated'` gate around `MembershipPane`); `src/lib/components/community/settings/MembershipPane.svelte`.
**Behavior:** `MembershipPane` mounts for moderated communities whenever a user is signed in; the PANE decides what to render from its own roster: nothing for non-admin non-owners; roster management + approvals for 39001 admins (their put-user/approve ops are personal-key NIP-29 ops — no community key needed); the application-form card (10222 writes) stays owner-gated (`isCommunityOwner`). `AccessTierEditor` + Typ card stay owner-gated in SettingsView (10222 writes). Unify the pane's `isAdmin` derivation accordingly (roster admins ∪ key-holding owner) and pass `roleSuggestions` through unchanged.
**TDD:** extend `MembershipPane.test.js` + `SettingsView.test.js`: non-owner 39001 admin sees roster management + approvals but NOT the application-form card; stranger sees nothing; owner sees all. Verify + check 0. Commit: `fix(community): 39001 admins reach roster management and approvals without the community key`.

---

### Task 4: Wizard Personen step (Moderiert)

**Files:** `src/lib/components/CreateCommunityModal.svelte`; `src/lib/components/community/create/wizard-logic.js` (+its test); `messages/*.json`; possibly `src/lib/components/__tests__/` additions.
**Behavior:** `communityWizardSteps` gains `'people'` after `'settings'` for moderated when the type step is visible (`{useCurrentKeypair, typeStepVisible, communityType}` — collapse guarantee: absent/hidden for open/closed and when flags off; extend the pure tests first). The step: invite list (ContactSearchInput precedent from GroupMembersModal), per-invitee role select fed by `['admin']` + free text, skippable (`create_community_modal_step_people: "Personen"`, plus `community_people_lead`, `_add_placeholder`, `_role_placeholder`, `_skip_hint`, `_invite_failed: "{count} Einladungen fehlgeschlagen"` — de+en). On `createCommunity()` for moderated: after the 10222 publish succeeds, sequential `putUserOn(rootPointer, pubkey, roles, humanUser)` fan-out via `roster-fanout.js`'s `fanOut`; aggregate failures → warning toast, never abort the created community. Confirm-step summary lists invitees.
**TDD:** wizard-logic tests for the step list; component-level verification via the existing hero/modal suites + `pnpm run check`; e2e stays green flags-off (Task 10 runs it). Commit: `feat(community): wizard Personen step with root-group invites`.

---

### Task 5: Community-card type badges

**Files:** Create `src/lib/stores/community-type.svelte.js` (`useCommunityType(getPubkey) → () => 'open'|'moderated'|'closed'|null` — addressLoader(kind 10222, pubkey, relays: getCommunikeyRelays()) + `eventStore.replaceable(10222, pubkey)` + `deriveCommunityType`; null while unknown); Modify `src/lib/components/CommunikeyCard.svelte` (small badge: 🛡️ `community_type_moderated_title` for moderated, 🔒 `community_type_closed_title` for closed, nothing for open/unknown; `data-testid="community-type-badge"`). For closed communities the card's `showJoinButton` follow-toggle is hidden (mirrors the hero).
**TDD:** jsdom test for the hook (mocked loader/eventStore) + card test (badge per type; no badge for open; closed hides join). Verify + check 0. Commit: `feat(community): type badges on community cards`.

---

### Task 6: Sidebar zone logic (pure) + shared tab helper

**Files:** Create `src/lib/components/community/layout/community-nav.js`; Modify `src/lib/helpers/contentTypes.js` only if the tab list needs a members row hook (prefer keeping `getCommunityTabs` untouched and adding members in the zone builder); Modify `src/lib/components/community/layout/ContentNavSidebar.svelte` + `BottomTabBar.svelte` ONLY to consume the shared helper for their existing tab list (behavior-identical this task); Test `src/lib/__tests__/community-nav.test.js`.
**Interfaces:**
- `communityNavTabs({communityEvent, concordEnabled, isOwner, isMember, hasGroupChannels}) → {id,label?,icon?}[]-shaped id list` — extracts the duplicated tab+channels-splice logic (`ContentNavSidebar.svelte:82-115` ≡ `BottomTabBar.svelte:89-112`) into ONE pure function returning ordered tab IDS + the splice decision (label/icon maps stay in the components); both components consume it (assert via their existing suites passing unchanged).
- `buildSidebarZones({tabs, channelRows, isMember, isOwner}) → {inhalte: string[], kanaele: ChannelRow[], footer: string[], showLockHint: boolean}` — inhalte = tabs minus `home|channels|settings|members`; kanaele = `channelRows` filtered per the visitor rule (non-member: `worldReadable` only, `showLockHint` true when rows were hidden), deduped by `row.key`; footer = `['members','settings']` (+`home` handled by the header row). Pure, unit-tested (visitor filtering, dedup, lock hint, empty-channel case → zone hidden).
**TDD:** node tests for both functions incl. the splice parity cases from `ContentNavSidebar.group-channels.test.svelte.js`'s fixtures. Verify: both component suites pass UNCHANGED this task + check 0. Commit: `refactor(community): shared nav-tab helper + pure sidebar zone builder`.

---

### Task 7: Two-zone sidebar UI (desktop)

**Files:** `src/lib/components/community/layout/ContentNavSidebar.svelte` (the rework); `src/routes/c/[pubkey]/+layout.svelte` (extend the `ContentNavData` getter with what the zones need: channelRows inputs, isMember, membership pointer — check `src/lib/types/layout.js`); `messages/*.json` (`community_nav_inhalte: "Inhalte"`, `community_nav_kanaele: "Kanäle"`, `community_nav_lock_hint: "Weitere Kanäle für Mitglieder"`, en equivalents); Tests: rework `src/lib/components/__tests__/ContentNavSidebar.group-channels.test.svelte.js` (the channels-TAB pin is DELIBERATELY replaced by zone assertions) + new cases.
**Behavior:** desktop sidebar renders: community header (unchanged) → **INHALTE** zone label + content rows (unchanged styling) → **KANÄLE** zone (only when rows exist or owner affordances apply): channel rows via `ChannelRailRow` (Concord rows: onclick → `goto(?view=channels&channel=<id>)` — the existing deep-link seeding in PrivateChannelsView takes over selection; active state when `selectedContentType==='channels'` && the shared selection matches; ConcordUnreadDot from `channelUnreadState`; NIP-29 rows: `href=groupHref(pointer)` exactly as PrivateChannelsView renders them; glyphs via the row's existing fields) + the lock hint row when `showLockHint` → footer rows (Mitglieder → `?view=members`, Einstellungen). The `channels` TAB disappears on desktop (zone replaces it); `areaUnreadState` dot moves to the KANÄLE zone label. BottomTabBar unchanged (keeps the tab via the shared helper). Channel-row data: build `channelRows` from the SAME inputs PrivateChannelsView uses — `buildChannelRows` with `useConcordCommunity` channels + `parseGroupPointers` + `useChannelMetadata` — instantiated ONCE in `c/[pubkey]/+layout.svelte` and threaded through ContentNavData (do NOT double-subscribe; PrivateChannelsView keeps its own instances this plan — note the known duplication for a future pass).
**TDD:** component tests — member sees both zones + footer; visitor sees only worldReadable rows + hint; zone hidden for open community without channels; Concord row click navigates with the channel param; NIP-29 row links out; channels tab absent from inhalte. e2e touchpoint: `e2e/layout-consistency.test.js` pins `content-nav-sidebar` geometry — run that spec (`pnpm run test:e2e -- layout-consistency`) and `community-membership`; fix fallout deliberately. Verify + check 0 + lint. Commit: `feat(community): two-zone sidebar — Inhalte + Kanäle in one nav column`.

---

### Task 8: UX debt sweep (handoff #5/#6/#7/#8/#10/#11)

**Files/behaviors (anchors from the handoff + explorer):**
- **#5** `AreaAttachModal.svelte`: clear `selectedKey` when a paste preview appears (the preview `$effect` ~:92-107) — covering test in its suite.
- **#6** label: `groups_attach_action` (de `"Kanal hinzufügen"` → `"Gruppe verknüpfen"`, en `"Add channel"` → `"Link group"`) matching `attach_modal_title`.
- **#7** parser unification: `src/routes/groups/+page.svelte:16,55` join field uses `parseGroupAddress` (forgiving) instead of strict `parseGroupInput`; keep `parseGroupInput` for internal/strict callers; extend `groups-page` tests.
- **#8** DRY: fold the `groupAttachCandidates` ≈ `unlinkedGroups` duplicated loop (attach-candidates.js vs unlinked-groups.js — extract the shared shaping) and the duplicated private `metadataName` helper; tests stay green.
- **#10** navigate into a freshly created channel: `PrivateChannelsView`'s `onCreated(id)` → `selectConcordChannel(communityId, id)` for Concord creations; for NIP-29 creations `goto(groupHref(pointer))`; covering test in the management suite.
- **#11** area-members polish: partial-remove no longer shows the contradictory repair prompt; `fanout_partial` toast names the refusing channels on removal too; the `area-members-open` entry hidden from visitors (member/owner-gated); sync toast count excludes implicit members. Extend `AreaMembersModal.test.js`.
Also: repoint the dead `PLANS/EDUFEED_APP_GRUPPEN_MERGE.md` comment references (grep `PLANS/`) to `docs/superpowers/specs/2026-08-12-groups-architecture-design.md`.
ONE commit: `fix(community): handoff UX-debt sweep (#5-#8, #10, #11)`.

---

### Task 9: NIP-29 mock relay (e2e infrastructure)

**Files:** Create `e2e/nip29-relay.js`; Modify `e2e/global-setup.js` + `e2e/global-teardown.js` (start/stop on port 17004, stored like `__HANGING_RELAY__`); Modify `playwright.config.js` (`RELAY_URLS.groups = 'ws://localhost:17004'`; `webServer.env`: `GROUPS_ENABLED: 'true'`, `GROUPS_RELAYS: RELAY_URLS.groups`); Test `e2e/nip29-relay.unit.test.js` (node vitest — NOT a Playwright spec; confirm the vitest include pattern picks e2e/*.unit.test.js or place it in src/lib/__tests__/ instead — state choice).
**Behavior (build on mock-relay.js's shape; keep it a separate module importing its helpers where sharable):** in-memory NIP-01 base PLUS: (a) live subscription fan-out (open REQs receive subsequently published matching events); (b) replaceable/addressable overwrite for kinds 39000-39003 (latest per kind+d wins); (c) NIP-29 moderation: 9007 creates a group (h tag = id; metadata from inline tags; `closed`/`restricted` markers respected), 9002 edits metadata, 9000 put-user (roles from the p tag; updates 39001 when roles non-empty per the "privileged roles are admins" reading, 39002 always), 9001 remove-user, 9009 registers an invite code, 9021 bare → OK:true ignored on closed groups / auto-put-user on open ones; 9021 with a registered code → put-user; 9022 → remove-user. Relay-signed 39000/39001/39002 regenerated + fanned out after every accepted moderation event (sign with a fixed relay key via nostr-tools). No NIP-42 (keep it open; the app's publishToGroupRelay handles no-auth fine).
**TDD:** unit tests exercising the lifecycle over a real WebSocket client (create → invite → coded join → roster; closed bare join ignored; replaceable overwrite; live fan-out to an open REQ). Verify + check 0. Commit: `test(e2e): in-process NIP-29 relay for moderated-lifecycle specs`.

---

### Task 10: Moderated-lifecycle browser E2E + flip E2E

**Files:** Create `e2e/moderated-community.test.js`; Modify `e2e/COVERAGE.md` (+ the community-creation spec if the now-enabled GROUPS flags change its flags-on behavior — its hermeticity interception should keep it green; verify).
**Specs (copy the concord-channels scaffolding: two contexts, `vis()`, `createCommunityWithCurrentKeypair`, English strings):**
1. Owner creates a MODERATED community through the wizard (type step now visible — GROUPS_ENABLED on; select Moderiert; default access Mitglieder; finish) → settings shows the Typ card as moderated; mints an invite code (mock relay accepts 9009) → second context (fresh key): community page shows no member badge; redeems the code via the hero → roster updates → member badge appears; owner sees the member in MembershipPane.
2. Flip lifecycle: owner creates OPEN community → settings → flip to moderated (confirm) → Typ card updates + membership tag present (assert via the settings card state); flip back to open (confirm dialog lists channels if any) → Typ card open again.
Assert through UI only (testids from plans 3-5). Update COVERAGE.md (remove the known-gap entry, add the new spec's coverage lines). Run: `pnpm run test:e2e -- moderated-community community-creation layout-consistency` — all green (host workaround env as needed).
Commit: `test(e2e): moderated community lifecycle + type-flip browser specs`.

---

### Task 11: Leftovers — MembersView roles, manager reactivity, misc

**Files:** `src/lib/components/community/views/MembersView.svelte` (moderated communities: member rows show role chips from the roster — instantiate `useRootRoster` there or consume via a prop-thread if cheap; visitor-visible since rosters are public; simple chips, no management); `src/lib/stores/accounts.svelte.js` + `src/lib/helpers/community-signer.js` (bounded manager-reactivity investigation per the scope decision — implement the version-counter bridge if applesauce exposes `accounts$`/`active$` cheaply, else document-and-close in the comment + design doc; state the outcome).
**TDD:** MembersView test extension (moderated fixture → role chips; open fixture unchanged). Verify + check 0. Commit: `feat(community): member role chips + manager-reactivity resolution`.

---

### Task 12: Closing — full verification, docs & NIP promotion

- [ ] `pnpm test` (only the pre-existing pomegranate collection failure; known-flaky reruns in isolation), `pnpm run check` 0, `pnpm run lint`, full `pnpm run test:e2e` (the whole suite once, host workaround env as needed — this is the only full-e2e run of the plan; budget 20+ min; known-flaky "shows user as joined" noted if it recurs).
- [ ] **NIP promotion:** `docs/nips/communikey-groups.md` — update the Status paragraph: implemented end-to-end by edufeed-app (plans 1-5, commit range), ready for external review/publication; reconcile any drift found during the read-through (e.g. the reviewer-capability sentence gets its "future" marker per the plan-4 review note).
- [ ] **Design doc closing:** mark Plan 5 items done with commit refs; add a short "Status: COMPLETE" header section summarizing what shipped across plans 1-5 and what remains deliberately deferred (NIP-29 sidebar unread, PrivateChannelsView duplicate row-builder instances, enforced-relay read side, 30222 removal, kind-9009 relay support caveat, MembersView role-tier decision if partially taken).
- [ ] **Buzz post draft:** write `docs/superpowers/notes/2026-08-13-groups-buzz-post-draft.md` — a German-language draft post for the buzz design thread (c69a3dc3…/3f4351e6…) summarizing the shipped architecture and linking the NIP draft, explicitly marked DRAFT — NOT posted (posting is laoc's call).
- [ ] `e2e/COVERAGE.md` totals refreshed. Commit docs (`git add -f`): `docs: close out groups plans 1-5 — NIP ready for review`.

---

## Deliberately deferred (recorded, no further plan)

NIP-29 unread in the sidebar/community rows; single-instance channel-row builder (layout-level) shared with PrivateChannelsView; enforced-relay read-side filtering; kind-30222 read removal; 9009 support on production GROUPS_RELAYS (deployment); Armada-style discoverable-invite links for Geschlossen (future feature per design).
