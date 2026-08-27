# Handoff: Groups architecture redesign (10222 × NIP-29 × Concord v2)

**Date:** 2026-08-12 · **Branch:** `feat/community-group-pointer` (HEAD `0265cbbd`, not merged, not pushed; laoc chose "keep as-is")
**Purpose:** starting brief for the planning session on how Communikey communities (10222), NIP-29 groups, and Concord v2 play together. The open issues below are INPUT to that plan.

## Where the branch stands (all review-clean, live-verified)

- **NIP-29 completion:** group creation (9007+9002, metadata inline on the 9007 for buzz), members-with-roles UI, role management, join/leave with membership-refusal handling, `publishToGroupRelay` (group relay only, one NIP-42 retry).
- **Stufe B (buzz design):** one ChannelCreateWizard for Concord AND NIP-29 (access question „Alle in dieser Community" / „Nur ausgewählte" + weltoffen toggle), area members with Stufe-2 fan-out + sync/repair, disclosure line above the composer, auth-capped weltoffen glyph.
- **Attach-modal redesign (today):** unified picker (no protocol tabs — picking implies protocol), paste fallback with 39000 preview gating the confirm, access question only for private NIP-29 targets. Spec: `docs/superpowers/specs/2026-08-12-attach-modal-redesign-design.md`.
- **Fixes:** relay-URL normalization (one host = one rail tile; 10009 dedupe by normalized relay, heals lazily on rewrite), sidebar no longer yanks to the active row mid-scroll (`shouldBringActiveIntoView`).

## Data model as implemented

- 10222 carries channel grouping only: `["group", id, relay, name?, access?]`, 5th slot `members|invited` = community intent (Stufe 2/3); weltoffen = no access slot. XOR: one community has ONE protected area kind (`attachableAreaModes`), Concord pointer `["concord", id, relay]`.
- `restricted` set in all NIP-29 tiers; open = open to READ. World-readability read from 39000 absence of `private`, capped by NIP-11 `auth_required`.
- Stufe-2 membership = explicit admin fan-out (put-user to every access=members channel), no automation. 9007 signed by acting admin's personal key.

## Open issues to fold into the plan

### Architecture-level (the reason for the redesign)
1. **`CONCORD_ENABLED` gates NIP-29 attach/create too** — settings area card hidden with flag off; owner cannot link a first group. Should NIP-29 support be independent of the Concord beta flag? (Worktree/.env now has both `CONCORD_ENABLED=true` and `CONCORD_RELAYS=wss://concord.edufeed.org`; main checkout `.env` has neither.)
2. **Concord v2 ("Cordn") relationship unresolved** — see memory `cordn-vs-concord-evaluation` (spike done, decision open). The redesign must say what v2 changes for: pointer tags, the XOR rule, the wizard's access question, area members.
3. **No "flip access tier" UI** — Stufe 2/3 is fixed at create/attach; changing intent later means editing the 10222 by hand.
4. **Category subtitle vs. rail disagreement** — picker categorizes without `hostRequiresAuth` (a no-`private` group on an auth relay shows „Weltoffen" in the picker, `members` in the rail). Decide the one rule.

### UX debt (small, could ride along or land first)
5. Attach modal: row-highlight vs. re-typed paste target desync (clear `selectedKey` when a preview appears).
6. Entry-point label „Kanal hinzufügen" (`PrivateChannelsView.svelte:370`, `groups_attach_action`) lags the modal title „Gruppe verknüpfen".
7. `/groups` join field still strict `parseGroupInput`; modal accepts `https?://host'id` via `parseGroupAddress` — unify.
8. DRY: `groupAttachCandidates` ≈ `unlinkedGroups` loop; second private `metadataName`.
9. Settings view spins forever for an owner without a kind-0 (`profileEvent && communikeyEvent` gate).
10. No navigation into a freshly created NIP-29 channel.
11. Area members polish: partial-remove deviation shows contradictory repair; `fanout_partial` doesn't name refusing channels on removal; entry not gated from visitors; toast count includes implicit members.
12. `PrivateChannelsView` owner-gating (`isCommunikeyOwner`) misses communities run from a separate keypair.

### Housekeeping
13. Stored 10009 slash-variant twins heal only on next list rewrite (rail already dedupes).
14. Deferred protocol work (pre-existing): enforced-relay read-side filtering, 30222 read removal.

## Relay facts (measured live, save the re-measuring)

- buzz 0.2.0 validates `name` on the 9007 itself; khatru (0xchat) reads metadata only from the 9002 — always send both.
- groups.0xchat.com now sends AUTH on connect (rate-limits unauthed writes); hzrd149 rejects non-member writes with "blocked: unknown member".
- relay.edufeed.org carries several junk 10222/kind-0 test events from throwaway keys (E2E residue, harmless, keys mostly discarded).

## Process pointers

- Design source of truth so far: the buzz thread (channel `c69a3dc3…`, root `3f4351e6…`) — categories not protocols, `#`/🔒 glyphs only, disclosure line. Any redesign should either extend or explicitly supersede it, and post back to the thread.
- Specs on the branch: `2026-08-11-nip29-completion-design.md`, `2026-08-11-gruppen-merge-stufe-b-design.md`, `2026-08-12-attach-modal-redesign-design.md` (+ plans).
- `docs/` is gitignored — `git add -f` for specs/plans.
