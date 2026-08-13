# Groups Architecture: 10222 × NIP-29 × Concord — Design

**Date:** 2026-08-12 · **Status:** approved in brainstorming session (laoc)
**Input:** `docs/superpowers/notes/2026-08-12-groups-architecture-handoff.md`
**Normative data model:** `docs/nips/communikey-groups.md` (working NIP draft — edited
during implementation, published as spec once stable; tag tables live THERE, not here)

## Problem

The app carries three community/group standards — open Communikey communities
(10222), NIP-29 groups, and Concord E2E areas — with no unified concept of what a
community *is*, who may publish to it, and how content pages and channels share
one page. The form-based membership approach and profile-list gating predate the
group protocols and overlap with them.

## Core decisions (each confirmed individually)

1. **Three community types, derived from the 10222** (see NIP draft):
   **Offen** (plain 10222) · **Moderiert** (+ NIP-29 root group) ·
   **Geschlossen** (+ E2E engine pointer, XOR with membership).
   German UI wording: *Offen · Moderiert · Geschlossen*.
2. **Enforcement is hybrid:** client display-filtering against the public NIP-29
   roster is the app semantics; relay-side write enforcement is an optional
   deployment upgrade (same contract as existing enforced relays). Gating is
   write-gating; reading is always public for Offen/Moderiert.
3. **Roster = truth, forms = intake:** the NIP-29 root group's roster+roles are
   the single membership source. The application form survives as optional
   structured intake (`application` tag) routed to admins holding `put-user`;
   approval executes `put-user`. Profile lists (30000) and badges (30009) become
   read-only legacy.
4. **XOR stays:** a community is Moderiert or Geschlossen, never both.
   Geschlossen = not outward-facing; everything happens inside.
5. **Geschlossen discovery:** visible shell, closed door — public kind-0 + 10222
   shell, directory entry, "invitation required" page, owner contactable via DM.
6. **Engine-agnostic private type:** "Geschlossen" is a product concept; the
   pointer tag names the engine (Concord today, Cordn or other later). The
   Cordn-vs-Concord decision stays decoupled from this design.
7. **Gating grain:** per content type, three tiers — alle / Mitglieder / Rolle
   (section-level `access` tag).
8. **Roster model:** one designated **root group** per moderated community is
   the membership engine; channels are further NIP-29 groups whose rosters
   mirror the root via the existing Stufe-2 fan-out/sync (implementation
   detail, not semantics).
9. **Type flips:** Offen ↔ Moderiert flippable in settings; Geschlossen fixed at
   creation. Flipping to Moderiert never retroactively gates (all sections start
   `alle`); flipping to Offen detaches channels (confirmed by owner).
10. **Open communities keep one simple chat** (kind 9 h-tag + forum), no channel
    system — wanting channels is a reason to flip to Moderiert.
11. **No legacy-group migration needed:** nothing was linked in production yet;
    existing communities all derive to Offen. Branch-attached test groups are
    re-linked by hand.

## UX

### Creation wizard (replaces CreateCommunityModal flow)

Profil → **Typ** → Inhalte → Personen. Type comes second because it reshapes the
later steps; protocol names appear nowhere — choosing a type silently provisions
the machinery.

- **Profil:** name/avatar/description → community keypair + kind-0 (existing flow).
- **Typ:** three cards (Moderiert = "empfohlen"), with flippability hints
  ("später umstellbar" / "endgültig").
- **Inhalte:** content-type checkboxes → sections + `strict` marker. Moderiert
  adds ONE default question — "Wer darf hier veröffentlichen?" (Alle / Nur
  Mitglieder) applied to all selected types; per-type/per-role tuning lives in
  settings only. Geschlossen replaces this step with "erste Kanäle".
- **Personen:** Offen skippable · Moderiert: invite npubs with role picker +
  invite code (9009) · Geschlossen: Concord invites (existing flow, including
  sign-before-account-switch ordering).
- On finish (Moderiert): 10222 + root group (9007+9002, owner admin) +
  `membership` tag; channels only if created later.

### Community page: one sidebar, two zones

- **Inhalte zone** (top): page-style rows from content sections (strict-filtered)
  — Materialien, Kalender, Artikel, … Pages look like pages.
- **Kanäle zone** (below): `#`/🔒 rows from `group` tags (Offen: single
  `# Chat`). Extends the buzz-thread design (glyphs, categories-not-protocols,
  disclosure line) rather than superseding it.
- Below: Info · Mitglieder.
- **Visitor filtering:** visitors see Inhalte + world-readable `#` channels +
  a join hint; 🔒 channels render only for members. World-readability uses ONE
  rule everywhere (39000 `private` absent, capped by NIP-11 `auth_required`) —
  resolves the picker-vs-rail disagreement (handoff #4).
- Existing unread badges attach to channel rows unchanged.

### Settings panes (owner/admins)

1. **Typ** — current type + flip actions with confirmations (resolves #3).
2. **Inhalte & Rechte** — per-section access editor (Alle / Mitglieder / Rolle,
   role dropdown fed from the root group's roles).
3. **Mitglieder & Rollen** — branch's members-with-roles UI keyed to the root
   group; invites; application-form pick/create (writes `application` tag).
4. **Kanäle** — existing channel create wizard + attach modal, plus detach.

Rides along here: fix settings spinner for communities without kind-0 (#9) and
owner-gating for separate-keypair communities (#12).

### Geschlossen shell page

Avatar, name, description, "Geschlossene Community" badge, "Nur auf Einladung"
explainer, owner DM contact, reserved slot for the future invite-link feature.

## Flows

### Joining (Moderiert)

One button; behavior by configuration: bare NIP-29 join request (9021) or invite
code — or, with an `application` tag, the form flow: fill 30168-referenced form →
encrypted 1069 p-tagged to reviewers (39001 admins with `put-user`; fallback all
admins) → approve = put-user (9000, optional role) + fan-out to `members`
channels → decline optionally DMs the applicant. Leave = 9022 + local unfollow.
Following stays independent of membership for all types.

### Rendering gated content

Community views query by h-tag as today, then filter authors against the
**current** root roster/role (39001/39002 loaded from the group relay into the
EventStore, shared across views). Consequences (deliberate): moderation is
retroactive for the community view; multi-community events render per-community.
Discover/AMB/multi-targeting untouched — content never leaves normal relays.
Composer: share picker disables communities where the user may not publish that
type, with reason; disclosure line kept.

## Feature flags

`GROUPS_ENABLED` gates NIP-29/Moderiert; `CONCORD_ENABLED` gates Geschlossen
(resolves #1 — decoupled). Both off → wizard collapses to Offen-only create.

## Handoff issue map

- Resolved by design: #1 (flags), #2 (engine-agnostic pointer), #3 (Typ pane),
  #4 (one readability rule).
- Ride along as implementation tasks in the components they touch: #5 attach-modal
  desync, #6 label unification, #7 parser unification, #8 DRY dedupe, #9 settings
  spinner, #10 navigate into fresh channel, #11 area-members polish, #12 owner
  gating.
- Unchanged: #13 (10009 twins, housekeeping), #14 (30222 removal deferred;
  enforced-relay read side superseded by the hybrid-enforcement contract).

## Testing

TDD, unit-first:

- **Unit:** type derivation, `access` parsing, roster/role gating filter,
  reviewer resolution, wizard/flip tag output (10222 before/after).
- **Component:** two-zone sidebar with visitor filtering, type cards, access
  editor.
- **E2E (two only, vs live buzz relay):** full Moderiert lifecycle (create →
  gate a type → member publish renders, non-member filtered) and the
  Offen ↔ Moderiert flip. Live-relay verification before claiming done.

## Future features (recorded, out of scope)

- **Discoverable Geschlossen communities:** Armada-style invite links (expiry,
  label) + "Share to Discover" toggle that publishes the link secret — private
  but publicly joinable. Lands on the shell page.
- Relay-side write-policy enforcement package (ops project; strfry writePolicy
  on homelab must be awk/sh).

## Binding follow-ups from plan 1's final review (fold into plans 2/3)

Plan 1 (core model & roster gating) shipped 2026-08-12; its final whole-branch
review found no merge blockers but named obligations the next plans MUST carry
as explicit tasks:

**Plan 2 (wizard, flips, settings):**

1. **DONE (24e40e79).** **Dashboard ACL path bypasses the facade** —
   `DashboardCommunityFeed.svelte` builds a legacy-only access object via
   `buildProfileAccess(acl.memberMap, …)`; moderated communities' tier-gated
   sections render unfiltered there. Route it through the roster-aware logic
   before `GROUPS_ENABLED` ships.
2. **DONE (81778d37/2b8cc4a7 + f263822b).** **Open→Moderiert flip MUST strip
   legacy `30000:` profile-list a-tags** from all sections (mixed
   legacy+roster state is internally inconsistent: lock icon + full-roster
   getMembers but unfiltered authors). Flip builders now strip the a-tags on
   moderated transition (81778d37/2b8cc4a7); the creation wizard sunsets
   writing new profile-list gating altogether (f263822b) — see the Legacy
   section of the NIP draft.
3. **DONE (22285063).** Wizard emits top-level tags (`membership`,
   `application`, `concord`) **before** content sections (positional-parser
   interop).

**Plan 2 deferred minors:**

- **DONE (fbe65182, plan-3 task 4).** Founding-marker admin check —
  moderated edit guards now verify admin status against the group's founding
  marker.
- **DONE (f263822b, plan-3 task 9).** Orphaned `concord_create_with_area_*`
  keys resolved — the key-ownership hint now surfaces on the Geschlossen
  card, and the unused title/body keys were deleted.

**Plan 3 (page IA, join flows):**

4. **DONE (e42c407f).** `getCommunityWideFormRef` (`communityFormDefaults.js`)
   is now tier-aware instead of filtering by `profileList` only.
5. **Resolved where it matters.** `getFormRef` shape divergence is moot for
   the facade path: `getCommunityWideFormRef` now serves the `30168:`
   application address directly for moderated communities, so plan-3 callers
   consume one shape. The remaining legacy-form-tag-URL shape still exists for
   old communities; wiring both shapes into AccessGateBanner/HomeView's
   join-flow UI stays Plan 4 work (see new Plan 4 item below).
6. Roster `isLoading` never terminates on a dead group relay (parity with the
   legacy hook) — add a loading timeout once user-visible. **Unchanged —
   carried to Plan 4.**
7. `getMembers` returns the full roster for role-tiered sections (not
   role-holders) — conscious UX decision needed for MembersView grouping.
   **Unchanged — carried to Plan 4.**
8. **DONE structurally.** `opts.membership` + `preservePointerTags`
   double-tag hazard: Plan 3's settings mutations (Typ flips, access-tier
   edits, membership/application wiring) go through `withSectionAccess` and
   the dedicated flip builders as direct tag surgery on the current event —
   none of them route through `opts.membership`/builder-opts merging, so the
   hazard never triggers in practice. The underlying `preservePointerTags`
   rule (exclude keys supplied via `opts`) remains unfixed in
   `communityTagBuilder` itself and still applies to any future caller that
   does pass `opts.membership` into the builder.

**New Plan 4 items (surfaced during plan-3 review):**

9. **DONE (7514ac34).** `HomeView`'s `canPublishAnywhere`/`accessDetail`
   still filter by `profileList` — swap to `sectionIsGated` (surfaced in
   plan-3 task 5 review).
10. **DONE (29671293).** `ChannelInviteSheet` exclude-community-pubkey gap
    + `FormResponses` decrypts kind `1069` with `manager.active.signer` —
    separate-keypair community owners can't decrypt applications; trace the
    encryption recipient through the intake/approvals work (surfaced in
    plan-3 task 1 fix review). `ChannelInviteSheet` now excludes the
    community's own pubkey from both the quick-pick list and free-text
    search (mirroring `ChannelCreateWizard`); `FormResponses` falls back to
    `getCommunitySigner` (guarded by `signerHasNip44`) when the active
    signer can't decrypt a legacy 1069, via the extracted, unit-tested
    `resolveFormResponseDecryptSigners` helper (`src/lib/helpers/forms.js`).

## Plan 4 shipping state (2026-08-12, commits 80a737fd..29671293)

Roster fan-out service extracted from `AreaMembersModal`; tier-aware `HomeView`
gating + closed-community hero; closed-community shell page + type-aware
tabs; moderated join button (9021, with invite-code path, load-gated —
absent `39000` counts as closed, matching the design's "capped by NIP-11
`auth_required`" readability rule); 9009 invite-code minting in
`MembershipPane`; per-reviewer application intake (39001-admin-encrypted,
all-admins fallback) with a submit gate; approvals queue (`put-user` →
roster fan-out → refresh → DM) with persistent decline; a binding-fixes
sweep (Task 8) covering the two items above plus hygiene.

**Live-relay caveat (Task 9 probe, `wss://groups.0xchat.com` —
this deployment's configured `GROUPS_RELAYS`):** kind `9009` (`create-invite`)
is rejected outright — `blocked: received event kind 9009 not allowed` —
confirmed deterministic across two independent create+invite attempts. The
invite-code UI (`MembershipPane`'s "create invite" button) and the
join-with-code path it feeds cannot be exercised end-to-end against this
relay; `9007`/`9002`/`9000`/`9021`/`9008` all work as spec'd. Separately, a
bare `9021` join request on a `closed` group returns `OK true` with no
membership granted (not an `OK false` rejection) — the relay silently
accepts-but-ignores rather than erroring, which the moderated join button's
refusal copy must account for (an `OK:true` is not proof of membership;
only a resulting `9000`/roster listing is). Full transcript:
`.superpowers/sdd/2026-08-12-groups-plan4-joining-visibility/task-9-report.md`.
Deployments that need working invite-code joins should verify `9009`
support on their own `GROUPS_RELAYS` before relying on this path.

## Plan 5 (next)

Carried from the handoff issue map (unresolved through Plan 4) plus items
surfaced by Plan 4's own review and Task 9's verification pass:

- **Two-zone sidebar IA** — Inhalte zone + Kanäle zone on the community page
  (design's "one sidebar, two zones" section, not yet built).
- **Community-card type badges** — needs a kind-10222 loader wired into the
  card components (discover/directory listings still show no Offen/
  Moderiert/Geschlossen indicator).
- **NIP-29 e2e relay decision** — no browser E2E covers the moderated
  lifecycle; needs either a NIP-29 relay added to the Playwright
  docker-compose stack or a mock-relay extension that speaks NIP-29
  moderation kinds. Task 9's scripted live-relay probe covers the protocol
  path in the interim (see e2e/COVERAGE.md known-gap entry).
- **Roster live-updates / `isLoading` timeout** — carried from Plan 3 item 6:
  roster `isLoading` never terminates against a dead/unreachable group relay
  (no parity with the legacy hook's timeout). Still unfixed after Plan 4.
- **MembersView role-tiered grouping** — carried from Plan 3 item 7:
  `getMembers` returns the full roster for role-tiered sections, not just
  role-holders; needs a conscious UX decision.
- **MembershipPane isAdmin vs 39001 refinement** — intersects the wizard
  Personen step (below); admin-check surface needs unification once that
  step exists.
- **Wizard Personen step** — the creation wizard's fourth step (invite
  npubs + role picker + invite code for Moderiert; Concord invites for
  Geschlossen) per the design's UX section; not yet built.
- **Handoff UX debt, ride-along items not yet touched:** #5 attach-modal
  desync, #6 label unification, #7 parser unification, #8 DRY dedupe, #10
  navigate into a freshly-created channel, #11 area-members polish.
- **`manager` reactivity signal** — outstanding from the handoff, not
  resolved by Plan 4.
- **Plan 4 final review (binding for Plan 5):**
  - **Personen-step PREREQUISITE:** non-owner 39001 reviewers can never reach
    the approvals queue — `SettingsView` gates `MembershipPane` on
    `isOwner` (key-holding), so a second admin's per-reviewer application
    copies are undeliverable in the UI (and pairwise-encrypted, so the owner
    cannot decrypt them either). Neutral today (single-admin reality), but
    MUST be fixed before or with the wizard Personen step.
  - **Decline key ruling:** re-key the approvals decline dismissal by
    `response.id` (per the `MembershipApprovalsPanel` precedent), not by
    applicant pubkey — the plan-4-prescribed pubkey key silently swallows
    re-applications. Controller-approved plan-text change.
  - **Pending-state invite affordance (early ride-along, ~5 lines):** the
    coded-join pending state hides the invite-code input permanently; keep
    it rendered alongside the pending message (code redemption is always
    legitimate — same rationale as the closed-39000 case). Matters doubly
    while relays answer `OK:true` for unregistered codes.
  - **`/forms/respond` error UX priority bump:** submit-time errors
    (`no-reviewers`, `unresolved`) currently replace the filled form with a
    dead-end alert, destroying typed input — render them above the form
    instead.
- **Task 9 ledger (found during this plan's final verification pass):**
  - `root-roster.svelte.js`'s loading state is the same dead-relay-`isLoading`
    gap as the item above, restated because Task 9 re-confirmed it live.
  - `ApplicationApprovals.svelte`'s `loadedExtraRelays` `SvelteSet` is
    created once at component init and never reset when `applicationRef`
    changes (community switch within a mounted instance) — stale entries
    from a previous community can suppress supplemental relay loading for
    the new one.
  - `FormResponses.svelte`'s decrypt loop silently no-ops when
    `resolveFormResponseDecryptSigners` returns an empty array (no active
    signer and no usable community-signer fallback): the `for` loop body
    never runs, so `decryptErrors` is never set and the row just never
    shows a decrypted value or an error — needs an explicit empty-signers
    branch.
  - `MembershipPane.svelte`'s `handleCopyInviteCode` passes a hardcoded
    English string (`'Clipboard not available'`) into
    `m.community_invite_failed({ reason })` instead of a translated message.
  - `group-management.js`'s `generateInviteCode` comment says "52-char
    alphabet" but the actual alphabet (`23456789ABCDEFGHJKMNPQRSTUVWXYZ
    abcdefghjkmnpqrstuvwxyz`) is 54 characters — stale comment, no
    functional bug.
  - `/forms/respond`'s `{:else if error}` branch is a dead end: unlike the
    `alreadyResponded` branch (which offers a "back to community"/"go back"
    button), the generic error alert renders with no retry or navigation
    affordance.

## Process

- This design + NIP draft supersede-and-extend the buzz thread
  (`c69a3dc3…`/`3f4351e6…`) as design source of truth; post the outcome back to
  the thread.
- Base branch for implementation: `feat/community-group-pointer` (all NIP-29 /
  Stufe B / attach-modal work carries forward).
- `docs/` is gitignored — `git add -f` for this file and the NIP draft.
