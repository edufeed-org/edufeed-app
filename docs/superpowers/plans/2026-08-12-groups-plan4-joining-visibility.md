# Groups Plan 4: Joining & Visibility — Implementation Plan (4 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make moderated-community membership usable end to end — join button with NIP-29 semantics (9021, invite codes), application-form intake encrypted to reviewers, an approvals queue that executes put-user + channel fan-out, decline notifications — plus the closed-community shell page and the binding gating/signer fixes.

**Architecture:** Reuse the proven pieces: the fan-out machinery extracted from `AreaMembersModal` into a service; the `MembershipApprovalsPanel`/`selectAdminApplications` per-admin-copy pattern for community applications; `sendWrappedDm` for notifications; the hero/`AccessGateBanner` surfaces that already exist. All NIP-29 ops sign with the human admin; all 10222 reads stay parse-only here (no 10222 writes in this plan).

**Tech Stack:** SvelteKit + Svelte 5 runes, JavaScript with JSDoc, Vitest, zero-dep Node probe for live relay verification.

**Spec:** `docs/superpowers/specs/2026-08-12-groups-architecture-design.md` ("Joining (Moderiert)", "Geschlossen shell page", follow-ups) and `docs/nips/communikey-groups.md` (`application` semantics, reviewer resolution).

**Roadmap note:** the former "Plan 4" is split: THIS plan = joining & visibility; Plan 5 = two-zone sidebar IA, community-card type badges (cards currently load only kind 0 — needs a 10222 loader), browser E2E of the moderated lifecycle (needs a NIP-29-capable relay in the e2e compose file — strfry does not implement NIP-29), and remaining UX debt (#5/#6/#7/#8/#10/#11).

**Controller scope decisions (do not re-litigate):**
- Root groups are `closed` (plan 2): bare 9021 is relay-ignored, 9021+invite-code is honored per NIP-29. Join button behavior: application form when the 10222 carries an `application` tag; otherwise invite-code entry (always) + bare join request only when the root group's 39000 lacks `closed`.
- Community application 1069s are encrypted PER REVIEWER (one copy per 39001 admin of the root group, NIP-44 pairwise, applicant signer → admin pubkey) — the `MembershipApplicationForm` pattern — NOT to the community pubkey. Reviewers decrypt with their own active signer; the FormResponses community-signer question therefore applies only to the LEGACY surface (Task 8 adds a fallback there).
- Decline = persistent local dismissal (localStorage, like `MembershipApprovalsPanel.rejectedKey`) + best-effort DM. No NIP-09, no protocol event.
- Approval DM copy is short and neutral; both DMs are try/catch-console.warn best-effort (precedent: `MembershipApprovalsPanel.svelte:275`).
- Closed shell: tabs collapse to `home` (+ `settings` for the key-holding owner); the shell renders instead of HomeView content; hero shows a closed badge and NO join button. Owner contact = link to the owner's profile page (`/p/<npub>`), where the existing DM affordance lives.
- The applicant's "pending" state is local-first (own 1069 detected via `buildUserResponseFilter` for form flow — `AccessGateBanner` already does this; for 9021 joins a session-local sent flag + roster check). No new protocol queries for pending 9021s in this plan.

## Global Constraints

- Worktree `/home/laoc/coding/edufeed/edufeed-app/.worktrees/group-pointer`, branch `feat/community-group-pointer`.
- JavaScript with JSDoc only. `pnpm run check` MUST exit 0 after every task. Malformed fixtures: `/** @type {any} */` casts.
- TDD; unit tests `src/lib/__tests__/` (node), component tests `src/lib/components/__tests__/` (jsdom).
- i18n: every string in BOTH `messages/de.json` (source) and `messages/en.json`.
- Signers: NIP-29 ops (9000/9021/9009) = ACTIVE HUMAN via `publishToGroupRelay`; NIP-44 encryption = applicant/sender signer; DMs = `sendWrappedDm` (active account). No 10222 writes in this plan.
- Tag-derived arrays feeding keyed `{#each}` go through `unique()`/`uniqueBy()`.
- `/c/[pubkey]` elements render up to 3× (responsive variants) — component tests must scope `:visible`-style or use the first match knowingly; follow existing test precedents.
- Commit per task with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; do NOT push.

---

### Task 1: Extract roster fan-out into a service

**Files:**
- Create: `src/lib/groups/roster-fanout.js`
- Modify: `src/lib/components/community/channels/AreaMembersModal.svelte` (delete its local copies at `:116` `tryOnce`, `:144` `fanOut`, `:172` `putUserOn`, `:183` `removeUserOn`; import from the service; keep `reportFanOut` local — it's toast/UI)
- Test: `src/lib/__tests__/roster-fanout.test.js`; run the existing `src/lib/components/__tests__/AreaMembersModal.test.js` unchanged (behavior-preserving refactor)

**Interfaces:**
- Produces (exact signatures, consumed by Task 7):
  - `putUserOn(pointer, pubkey, roles = [], user) → Promise<void>` — `publishToGroupRelay(pool.relay(pointer.relay), buildPutUserTemplate(pointer.id, pubkey, roles), user)`; `user = {pubkey, signer}` REQUIRED (no implicit active-user read in the service — the component passes it).
  - `removeUserOn(pointer, pubkey, user) → Promise<void>`
  - `tryOnce(item, label, action) → Promise<{key: string, ok: boolean}>` — one retry, never throws (port the modal's logic verbatim).
  - `fanOut(items, keyOf, action) → Promise<{ok: string[], failed: string[]}>` — SEQUENTIAL (deliberate), aggregates via `aggregateFanOut`.

- [ ] **Step 1: Failing unit test** — mock `$lib/stores/nostr-infrastructure.svelte` (pool.relay) and `$lib/groups/group-management.js` (publishToGroupRelay, buildPutUserTemplate/buildRemoveUserTemplate as pass-through spies): `putUserOn` builds the right template and publishes to the pointer's relay with the given user; `tryOnce` retries once then reports `{ok:false}` without throwing; `fanOut` runs sequentially (assert call order) and aggregates ok/failed.
- [ ] **Step 2: Verify failure. Step 3: Implement (port verbatim from the modal, adding the explicit `user` param). Step 4: Rewire the modal (its calls pass `getActiveUser()`); run the new unit test + `pnpm vitest run src/lib/components/__tests__/AreaMembersModal.test.js` — the modal suite passes UNCHANGED. check 0; lint clean.**
- [ ] **Step 5: Commit** — `refactor(groups): extract roster fan-out service from AreaMembersModal`

---

### Task 2: HomeView tier-aware gating + closed-community hero

**Files:**
- Modify: `src/lib/components/community/views/HomeView.svelte:46-63` (`canPublishAnywhere`, `accessDetail`: swap `.filter(s => s.profileList)` → `.filter(sectionIsGated)`, import from `$lib/helpers/communityRelays.js`)
- Modify: `src/lib/components/community/views/CommunityProfileHero.svelte` (closed handling)
- Modify: `messages/de.json` + `messages/en.json`
- Test: Create `src/lib/components/__tests__/CommunityProfileHero.test.js` (greenfield); extend HomeView coverage only if a suite exists (check first; else the filter swap is covered by the contentTypes-level tests + the new hero test)

**Behavior:**
1. The two HomeView filters use `sectionIsGated` — this makes the community-wide `AccessGateBanner` (`:195-205`) actually render for moderated communities (it currently never does).
2. `CommunityProfileHero`: derive `communityType` from the (already loaded) community event — the hero receives `communityId`; get the event via the layout's `communikeyEvent` context (`getContext('communikeyEvent')`, set at `+layout.svelte:156`) or an added prop from HomeView (`HomeView.svelte:185` renders it — prefer passing `communikeyEvent` down as a prop, smaller blast radius). For `closed`: render a badge `community_type_closed_title` + `community_hero_closed_hint` ("Nur auf Einladung") and NO join/leave button (the follow-set join is meaningless there). Open/moderated unchanged in this task (moderated join lands in Task 4).

**i18n:** `community_hero_closed_hint: "Nur auf Einladung"` (en: "Invitation only").

- [ ] **Step 1: Failing tests** — hero with a closed event (concord pointer tag) renders the badge and no Join button; hero with an open event renders the Join button (baseline).
- [ ] **Steps 2-4: fail → implement → verify** (`pnpm vitest run` the new test + `src/lib/__tests__/contentTypes-access-tiers.test.js` + `src/lib/__tests__/communityFormDefaults.test.js`; check 0; lint).
- [ ] **Step 5: Commit** — `fix(community): tier-aware home gating + closed-community hero`

---

### Task 3: Closed-community shell page + type-aware tabs

**Files:**
- Create: `src/lib/components/community/views/ClosedCommunityShell.svelte`
- Modify: `src/lib/helpers/contentTypes.js` (`getCommunityTabs` at `:485`)
- Modify: `src/lib/components/community/layout/MainContentArea.svelte` (shell slot after the `isLoading` branch at `:51-55`)
- Modify: `messages/de.json` + `messages/en.json`
- Test: extend `src/lib/__tests__/contentTypes-access-tiers.test.js` (tabs) + create `src/lib/components/__tests__/ClosedCommunityShell.test.js`

**Behavior:**
1. `getCommunityTabs(communityEvent)`: when `deriveCommunityType(communityEvent) === 'closed'` return `['home', 'settings']` (import `deriveCommunityType` from `$lib/groups/community-membership.js` — pure, no cycle: contentTypes.js already imports from communityRelays.js only; verify no import cycle and note in report). All other types unchanged (fail-open rules preserved).
2. `MainContentArea`: when the derived type is closed, `selectedContentType === 'home'` renders `<ClosedCommunityShell {communikeyEvent} communityProfile={...} />` instead of `HomeView` (settings stays reachable for the owner). Keep the change minimal — a condition in the existing ladder.
3. `ClosedCommunityShell`: avatar/name/description from the community profile (reuse the profile pieces the hero uses — check `CommunityProfileHero` for the profile-loading idiom and reuse, don't duplicate loaders), the closed badge, `community_shell_lead` explainer, and an owner-contact link to `/p/<npub>` (`community_shell_contact_owner`). A muted note reserves the future invite-link slot (`community_shell_invite_future` — static text, design's recorded future feature).

**i18n:** `community_shell_lead: "Diese Community ist geschlossen. Inhalte und Kanäle sind nur für eingeladene Mitglieder sichtbar."`, `community_shell_contact_owner: "Betreiber*in kontaktieren"`, `community_shell_invite_future: "Beitritt nur auf Einladung."` (+ English).

- [ ] **Step 1: Failing tests** — `getCommunityTabs(closedEvent)` → `['home','settings']`; open/moderated/legacy fixtures unchanged; shell component renders badge + contact link for a closed event.
- [ ] **Steps 2-4: fail → implement → verify** (new tests + existing contentTypes suites + `pnpm vitest run src/lib/components/__tests__ -t Sidebar` equivalents if tab-consumers have suites — `ContentNavSidebar.group-channels.test.svelte.js` must stay green; check 0; lint).
- [ ] **Step 5: Commit** — `feat(community): closed-community shell page + type-aware tabs`

---

### Task 4: Moderated join button (9021 + invite codes, applicant side)

**Files:**
- Create: `src/lib/groups/join-community-group.js` (pure-ish service)
- Modify: `src/lib/components/community/views/CommunityProfileHero.svelte`
- Modify: `messages/de.json` + `messages/en.json`
- Test: `src/lib/__tests__/join-community-group.test.js` + extend `src/lib/components/__tests__/CommunityProfileHero.test.js`

**Interfaces / behavior:**
1. Service `joinCommunityGroup({pointer, code = null, user}) → Promise<void>` — `publishToGroupRelay(pool.relay(pointer.relay), buildJoinRequestTemplate(pointer.id, code ?? undefined), user)`; rethrows with the relay reason (caller toasts). (`buildJoinRequestTemplate`'s `code` param finally gets a caller.)
2. Hero, moderated communities (event has a membership pointer):
   - Instantiate `useRootRoster(() => communikeyEvent)` and `useChannelMetadata`-equivalent for the root group's 39000 (check `src/lib/groups/channel-metadata.svelte.js:20 useChannelMetadata(getPointers)` — reuse it with the root pointer to read the `closed` marker via `channel-access.js` semantics; the 39000 `closed` tag means bare join requests are ignored).
   - States: roster `isMember(activeUser)` → "Mitglied" badge (follow button unchanged beside it — following stays independent). Not member + `application` tag present → keep the existing "Request join" form routing (it already works via `communityWideFormRef`). Not member + no application tag: if 39000 lacks `closed` → button `community_join_group` sending a bare 9021; ALWAYS additionally a small "Einladungscode einlösen" affordance opening an inline input → `joinCommunityGroup({code})`. After a successful send: session-local `requestSent` state renders `community_join_pending` (roster refresh on success; membership appears when the relay adds us).
   - Refusal/errors: catch → toast with the relay message; `isMembershipRefusal` gets a friendlier `community_join_refused` toast.
3. Anonymous users: unchanged (no join affordances).

**i18n:** `community_join_group: "Beitreten"`, `community_join_pending: "Anfrage gesendet — wartet auf Freigabe."`, `community_join_member: "Mitglied"`, `community_join_invite_toggle: "Einladungscode einlösen"`, `community_join_invite_placeholder: "Code"`, `community_join_invite_submit: "Einlösen"`, `community_join_refused: "Der Beitritt wurde vom Relay abgelehnt."`, `community_join_failed: "Beitritt fehlgeschlagen: {reason}"` (+ English).

- [ ] **Step 1: Failing tests** — service: builds 9021 with/without code tag, publishes to the pointer relay with the given user, rethrows. Hero: moderated fixture + mocked roster (member) shows the member badge; non-member with application tag keeps the form button; non-member without application + non-closed 39000 shows the join button; invite-code input submits with the code (assert the service mock got it).
- [ ] **Steps 2-4: fail → implement → verify** (new + hero + `groups-helpers` suites; check 0; lint).
- [ ] **Step 5: Commit** — `feat(community): moderated join button with 9021 + invite codes`

---

### Task 5: Invite-code minting (9009) in MembershipPane

**Files:**
- Modify: `src/lib/groups/group-management.js` (add `buildCreateInviteTemplate`)
- Modify: `src/lib/components/community/settings/MembershipPane.svelte`
- Modify: `messages/de.json` + `messages/en.json`
- Test: extend `src/lib/__tests__/group-management.test.js` + `src/lib/components/__tests__/MembershipPane.test.js`

**Behavior:**
1. `buildCreateInviteTemplate(groupId, code) → {kind: 9009, content: '', tags: [['h', groupId], ['code', code]], created_at}` (match the file's template style). Code generation: 12 chars from `crypto.getRandomValues`, unambiguous alphabet — a tiny `generateInviteCode()` export beside it.
2. MembershipPane gains an "Einladungscode" block (admin-gated like the rest): button mints a code locally, publishes 9009 via `publishToGroupRelay` with the ACTIVE user, then displays the code with a copy button (`navigator.clipboard`). Codes are NOT persisted client-side (relay holds the state); the block shows only the most recently minted code this session, with a hint that the code can be redeemed on the community page. Errors → toast.

**i18n:** `community_invite_title: "Einladungscode"`, `community_invite_create: "Code erstellen"`, `community_invite_hint: "Der Code kann auf der Community-Seite unter „Einladungscode einlösen“ verwendet werden."`, `community_invite_copy: "Kopieren"`, `community_invite_copied: "Kopiert."`, `community_invite_failed: "Code konnte nicht erstellt werden: {reason}"` (+ English).

- [ ] **Step 1: Failing tests** — template builder (kind/tags/code); `generateInviteCode` shape; pane: mint button publishes 9009 to the roster pointer's relay and renders the code.
- [ ] **Steps 2-4: fail → implement → verify.** **Step 5: Commit** — `feat(groups): NIP-29 invite-code minting (9009) in membership settings`

---

### Task 6: Application intake — per-reviewer encrypted copies

**Files:**
- Create: `src/lib/helpers/community-application.js`
- Modify: `src/routes/forms/[naddr=naddr]/respond/+page.svelte` (`handleSubmit` at `:96-145`)
- Modify: `src/lib/services/inbox-service.svelte.js` (collision guard at `:193`)
- Test: `src/lib/__tests__/community-application.test.js`

**Interfaces / behavior:**
1. `community-application.js` exports:
   - `isCommunityApplication(formAddress, communityEvent) → boolean` — true iff `parseApplicationRef(communityEvent)?.address === formAddress`.
   - `resolveReviewers(communityEvent) → Promise<string[]>` — parse the membership pointer, fetch the root group's 39001 via `confirmGroupAdmins(pool.relay(pointer.relay), pointer.id)` (exists in `group-management.js:122`), return admin pubkeys via `getGroupAdmins` (deduped, non-empty required — throw a typed error `no-reviewers` when the list is empty/unreachable; UI translates it).
   - `buildApplicationCopies({formAddress, values, signer, reviewers}) → Promise<SignedEvent[]>` — one 1069 per reviewer: tags `[['a', formAddress], ['p', reviewer], ['encrypted']]`, content `nip44EncryptWith(signer, reviewer, JSON.stringify(buildResponseTags(values)))`, built+signed via `createAppEventFactory` (mirror `MembershipApplicationForm.svelte:265-288` but per-reviewer; use `buildATagWithHint`/`buildPTagsWithHints` where the precedent does).
2. Respond route: in `handleSubmit`, when `?communityId=` is present AND the community's 10222 (load it — the route already has `getCommunikeyRelays()` and addressLoader precedents; communityId arrives as the community pubkey — check how `handleRequestJoin` encodes it at `CommunityProfileHero.svelte:36` and decode accordingly) satisfies `isCommunityApplication`: use `resolveReviewers` + `buildApplicationCopies` and publish each copy via `publishEvent(copy, [reviewerPubkey])` (outbox unions the reviewer's read relays); partial-delivery semantics like the membership panel (all-failed → error; partial → warning toast). Everything else (legacy forms, public forms) keeps the existing single-copy path byte-identical.
3. Inbox guard: at `inbox-service.svelte.js:193`, ignore 1069s whose `#a` equals `runtimeConfig.membership.formAddress` ONLY when they are also p-tagged to a configured membership admin — i.e. add the admin-pubkey check so community applications that happen to share a form address don't surface in the deployment membership inbox (read the surrounding filter first; keep the change minimal and comment the collision case).

**i18n:** `form_respond_no_reviewers: "Für diese Community sind keine Admins auffindbar — Bewerbung kann nicht zugestellt werden."` (+ English), plus a partial-delivery warning key if none is reusable (check `membership_application_*` family first).

- [ ] **Step 1: Failing tests** — `isCommunityApplication` truth table; `resolveReviewers` (mocked confirmGroupAdmins: admins → pubkeys; empty/throw → typed error); `buildApplicationCopies` (N reviewers → N signed events, each p-tagged + encrypted to its reviewer — assert `nip44EncryptWith` called per reviewer with the right pubkey, mock the crypto).
- [ ] **Steps 2-4: fail → implement → verify** (new suite + `pnpm vitest run src/lib/__tests__/forms.test.js src/lib/__tests__/membership-publish.test.js` + any inbox-service suite; check 0; lint).
- [ ] **Step 5: Commit** — `feat(community): application intake encrypts per reviewer (39001 admins)`

---

### Task 7: Approvals queue in MembershipPane

**Files:**
- Create: `src/lib/components/community/settings/ApplicationApprovals.svelte`
- Modify: `src/lib/components/community/settings/MembershipPane.svelte` (render the queue when an application tag exists)
- Modify: `messages/de.json` + `messages/en.json`
- Test: `src/lib/components/__tests__/ApplicationApprovals.test.js`

**Behavior (parallel the deployment panel `MembershipApprovalsPanel.svelte` + `selectAdminApplications`):**
1. Load 1069s for the community's application address, filtered to copies p-tagged to the ACTIVE user, newest-per-applicant (reuse `selectAdminApplications(events, formAddress, adminPubkey)` from `src/lib/helpers/membership-applications.js:32` — verify its signature fits; if it's membership-specific, add a thin wrapper, don't fork the logic). Loader: `formResponseLoader`-style timeline over `getCommunikeyRelays()` (see `src/lib/loaders/community.js:40`) — check whether its `#p` filter fits or a new filter is needed.
2. Decrypt with the active signer (`nip44DecryptWith(manager.active.signer, response.pubkey, content)`), render parsed response fields (reuse the deployment panel's rendering approach, simplified).
3. **Approve:** `putUserOn(rootPointer, applicant, [], user)` then `fanOut(stufe2Pointers(communikeyEvent).map(...), ...)` (Task 1 service; sequential; aggregate toast), `getRoster().refresh()`, then best-effort `sendWrappedDm(applicant, m.community_application_approved_dm({community: name}))`. In-flight per-applicant state; errors → toast, applicant stays in queue.
4. **Decline:** persistent local dismissal in localStorage keyed `communityApplication:declined:<communityId>:<applicantPubkey>` + optional best-effort DM `community_application_declined_dm`. Undo affordance while in session (mirror `denyAccess`/`undoDeny` UX of FormResponses, but persistent).
5. Roster-aware: applicants already on the roster show as approved (no buttons).

**i18n:** `community_applications_title: "Beitrittsanfragen"`, `_empty: "Keine offenen Anfragen."`, `_approve: "Aufnehmen"`, `_decline: "Ablehnen"`, `_undo: "Rückgängig"`, `_approved_badge: "Aufgenommen"`, `_decrypt_failed: "Antwort konnte nicht entschlüsselt werden."`, `community_application_approved_dm: "Deine Beitrittsanfrage für {community} wurde angenommen — willkommen!"`, `community_application_declined_dm: "Deine Beitrittsanfrage für {community} wurde leider abgelehnt."`, `_approve_failed: "Aufnahme fehlgeschlagen: {reason}"` (+ English).

- [ ] **Step 1: Failing component test** — mocked loader/eventStore delivering two encrypted copies (one p-tagged to me, one to someone else) → only mine renders after decrypt (mock nip44DecryptWith); approve calls putUserOn with the root pointer + fanOut over the stufe-2 pointers + refresh + sendWrappedDm (all mocked, assert order: root putUser BEFORE fan-out); decline persists the localStorage key and hides the row; roster-member applicant shows the approved badge.
- [ ] **Steps 2-4: fail → implement → verify** (new + MembershipPane + SettingsView suites; check 0; lint).
- [ ] **Step 5: Commit** — `feat(community): application approvals queue with put-user + channel fan-out`

---

### Task 8: Binding fixes + hygiene sweep

**Files:**
- Modify: `src/lib/components/forms/FormResponses.svelte:256-281` (decrypt fallback)
- Modify: `src/lib/components/community/channels/ChannelInviteSheet.svelte:152,217` (exclude community pubkey)
- Modify: `src/lib/components/community/settings/AccessTierEditor.svelte` (whitespace-normalize the dirty comparison — plan-3 deferred minor)
- Modify: `src/lib/helpers/community-signer.js` (comment correction: manager reactivity is NOT guaranteed for mid-session account changes)
- Modify: `messages/de.json` + `messages/en.json` (DELETE the orphaned `form_config_gated_summary` from both)
- Modify: `docs/nips/communikey-groups.md` (one sentence in Legacy: editing an existing legacy-gated open community MAY retain its form-gating UI — deliberate transitional exception)
- Test: extend `src/lib/components/__tests__/AccessTierEditor.test.js` (whitespace case); FormResponses: extend its suite if one exists, else assert via a focused unit of the extracted fallback (state which in the report)

**Behavior:**
1. FormResponses decrypt: try `manager.active.signer` first (current behavior); on failure, if `getCommunitySigner(formEvent.pubkey)` yields a signer with NIP-44 decrypt (`signerHasNip44`), retry with it (legacy 1069s are encrypted to the form author = community; separate-keypair owners could not decrypt them before this).
2. ChannelInviteSheet: both `self` exclusions also exclude `communikeyEvent?.pubkey` (mirror ChannelCreateWizard's plan-3 fix).
3. AccessTierEditor: normalize (`trim()`) the role in the dirty comparison so whitespace-only differences don't mark a row permanently dirty.
4. Comment + i18n + NIP edits as listed.

- [ ] **Steps: TDD where testable (whitespace case; decrypt fallback), grep-verify the i18n deletion leaves no references, verify + check 0 + lint, ONE commit** — `fix(community): decrypt fallback, invite exclusions, editor polish + hygiene`

---

### Task 9: Full verification, live relay probe, docs sync

**Files:** possibly `docs/superpowers/specs/2026-08-12-groups-architecture-design.md`, `e2e/COVERAGE.md`; probe script in the session scratchpad (NOT committed)

- [ ] **Step 1: Full suite** — `pnpm test` (expect only the pre-existing pomegranate collection failure; known-flaky files rerun in isolation), `pnpm run check` exit 0, `pnpm run lint`.
- [ ] **Step 2: Live probe** (zero-dep Node + nostr-tools from node_modules, against the first `GROUPS_RELAYS` relay in `.env`; skip gracefully if unset): with throwaway key A: 9007 create (closed+restricted metadata) → 9009 create-invite with a generated code → with throwaway key B: bare 9021 (expect ignored/rejected on the closed group) → 9021 with the code (expect membership: 39002 lists B) → A: put-user B with role `probe` → 39001/39002 reflect → 9008 cleanup. Handle NIP-42. Report every OK/response verbatim. Findings to surface prominently: does the relay honor 9009+code on closed groups (the join flow's core assumption); does a bare 9021 on a closed group error or silently vanish (affects Task 4's refusal UX copy).
- [ ] **Step 3: Docs** — design doc: mark this plan's follow-ups done (HomeView sectionIsGated, ChannelInviteSheet, FormResponses fallback), note the invite-code + application-intake shipping state, and record Plan 5's list (sidebar IA, card badges + 10222 loader, NIP-29 e2e relay decision, UX debt #5-#8/#10/#11, roster live-updates, MembershipPane-isAdmin-vs-39001). `e2e/COVERAGE.md`: add a "known gap" line — moderated lifecycle has no browser E2E yet (needs NIP-29 relay in compose; scripted live probe covers the protocol path).
- [ ] **Step 4: Commit docs** (`git add -f`) — `docs: sync after plan 4 (joining & visibility)`

---

## Out of scope (→ Plan 5)

Two-zone sidebar IA; community-card type badges (needs 10222 loader in cards); browser E2E of the moderated lifecycle (NIP-29 relay for docker-compose or mock-relay extension); roster live-updates / loading timeout; MembershipPane isAdmin vs 39001 refinement (intersects the wizard Personen step); wizard Personen step; handoff UX debt #5 (attach-modal desync), #6 (label), #7 (parser unification), #8 (DRY), #10 (navigate into fresh channel), #11 (area-members polish); `manager` reactivity signal.
