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

9. `HomeView`'s `canPublishAnywhere`/`accessDetail` still filter by
   `profileList` — swap to `sectionIsGated` (surfaced in plan-3 task 5
   review).
10. `ChannelInviteSheet` exclude-community-pubkey gap + `FormResponses`
    decrypts kind `1069` with `manager.active.signer` — separate-keypair
    community owners can't decrypt applications; trace the encryption
    recipient through the intake/approvals work (surfaced in plan-3 task 1
    fix review).

## Process

- This design + NIP draft supersede-and-extend the buzz thread
  (`c69a3dc3…`/`3f4351e6…`) as design source of truth; post the outcome back to
  the thread.
- Base branch for implementation: `feat/community-group-pointer` (all NIP-29 /
  Stufe B / attach-modal work carries forward).
- `docs/` is gitignored — `git add -f` for this file and the NIP draft.
