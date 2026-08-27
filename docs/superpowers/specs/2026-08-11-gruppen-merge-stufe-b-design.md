# Gruppen-Merge Stufe B — Design Conformance

**Date:** 2026-08-11
**Branch:** `feat/community-group-pointer`
**Source of truth:** the buzz design thread (channel `c69a3dc3…`, root `3f4351e6…`,
four design rounds + `PLANS/EDUFEED_APP_GRUPPEN_MERGE.md`), plus laoc's answers
of 2026-08-11 to the three questions the thread left open.

## Decisions carried over from the thread (fixed, do not relitigate)

- Categories, not protocols: **Offene Community · Geschlossene Gruppe ·
  Verschlüsselte Gruppe**. The protocol name appears at most once, small.
- A community is extended by exactly ONE protected area (XOR, implemented).
- Channels are sibling NIP-29 groups (design (c)); the 10222 carries only the
  grouping (`["group", id, relay, name?, access?]`), never the access.
- Three access levels; **`#` and 🔒 stay the only glyphs**, weltoffen is a
  globe suffix on `#` (implemented, incl. the auth-required cap).
- `restricted` is set in ALL levels — open means open to READ (implemented).
- Stufe 2 and 3 are the same relay object (private group + member list); the
  difference is who our client puts on the list. The pointer's 5th slot
  (`access: 'members' | 'invited'`) records the community's intent
  (implemented as data; the behavior behind it is this spec).

## laoc's answers (2026-08-11)

1. **9007 signer:** the acting admin's personal key (creator→admin is what
   relays grant). No community co-admin event in v1.
2. **Stufe 2 propagation:** explicit admin action fans out — adding a member
   at the AREA level sends put-user to every `access === 'members'` channel;
   a sync action surfaces and repairs deviations. No silent on-join automation.
3. **One wizard:** the channel wizard absorbs NIP-29 creation; the attach
   modal keeps attach-existing only. (The relay-page create modal stays — it
   serves standalone hosts, outside communities.)

## Scope

### 1. One channel wizard (design B2)

`ChannelCreateWizard` (today Concord-only) becomes the single "Kanal anlegen"
for communities with a protected area of either kind:

- The privacy question becomes the access question with two answers —
  **„Alle in dieser Community"** (Stufe 2) and **„Nur ausgewählte
  Mitglieder"** (Stufe 3) — plus, for NIP-29 communities only, a
  **„Von außen lesbar (weltoffen)"** sub-toggle under the first answer.
  Encrypted communities never see the toggle (impossible); the subtitle
  under each answer switches with the community type, naming no protocol.
- Backend dispatch by the community's area type (`attachableAreaModes` /
  existing pointers): Concord → existing path unchanged; NIP-29 →
  `createGroupOnRelay` on the area's relay (personal key), then
  `attachGroupChannel` with `access: 'members' | 'invited'` and, for
  weltoffen, metadata without `private` (isPublic=true). Stufe 2/3 both:
  `private` + `closed` (+ always `restricted`).
- After a Stufe-2 channel is created, the creator fans out put-user for the
  current area members (see §2) so the channel starts populated.
- `AreaAttachModal` loses its create sub-mode (attach-existing + first-time
  area choice remain). The create-tab component tests move/adapt to the
  wizard.

### 2. Area members + Stufe-2 fan-out

New surface on the community's channels tab (next to the channel overview):
**Mitglieder des Bereichs** —

- **Area member list** = union of the member lists (39002) of all
  `access === 'members'` channels; each row shows deviation badges when a
  member is missing from some Stufe-2 channel.
- **Add member** (admins): `ContactSearchInput` → put-user to EVERY Stufe-2
  channel of the area. Partial failure: per-channel retry (once), then the
  member row shows which channels failed; nothing silent (the plan's
  "teilweise Mitgliedschaft" case).
- **Remove member** (admins): remove-user fan-out with the same reporting.
- **„Mitglieder abgleichen"** (sync): recompute deviations, offer one-click
  repair (missing put-user events), report the outcome.
- Pure logic (union, deviation computation, fan-out planning) lives in
  `src/lib/groups/area-members.js`; publishing via `publishToGroupRelay`.
  Admin capability = being in the 39001 of the respective channel; rows the
  acting user cannot repair are shown as such, not hidden.

### 3. Disclosure line (design: „Offenlegungszeile")

One quiet line above the composer, stating who can read — numbers, not roles:

- weltoffen: „Alle im Netz können mitlesen — auch ohne Konto."
- Stufe 2: „Mitlesen können: alle N Mitglieder" (N = channel 39002 size).
- Stufe 3: „Mitlesen können: N ausgewählte Mitglieder."
- Concord channel: „Ende-zu-Ende verschlüsselt — nur Mitglieder können
  mitlesen."

Pure helper `disclosureLine(...)` (i18n keys with `{count}` params, de+en),
rendered in GroupChat (from metadata + pointer access) and ChannelChat
(Concord constant). No layout shift: the line is part of the composer block.

## Error handling

All NIP-29 publishes through `publishToGroupRelay` (auth retry, loud
failures). Fan-out uses per-channel try/catch with one retry; outcomes are
aggregated and displayed, never toasted one-by-one (N toasts for N channels
is noise). Membership refusals keep the join-first wording.

## Testing

Unit: access-question → metadata/pointer mapping; area-members union +
deviation + fan-out plan (incl. partial-failure aggregation); disclosure
text selection. Component: wizard shows the two answers + conditional
weltoffen toggle, dispatches to the right backend (mocked); area members
modal gating + fan-out calls + deviation rendering; disclosure line in both
chat surfaces. No new E2E; live verification against the buzz relay at the
end (laoc's own membership).

## Out of scope

Subgroups (`parent`/`child` — Stufe C, "später oder nie"), pyramid patches
(rejected in the thread), Cordn reactivation, relay-page create-modal
changes, DM-row naming by roster.
