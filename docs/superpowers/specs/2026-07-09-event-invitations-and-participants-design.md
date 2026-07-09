# Event Invitations & Person Association — Design

**Date:** 2026-07-09
**Issue:** [#14 — Invite people to events / connect persons with an event](https://git.edufeed.org/edufeed/edufeed-app/issues/14)
**Status:** Approved design, pending implementation plan

## Problem

From the Comenius test report: users want to (1) actively invite specific
people to a calendar event, and (2) connect persons (speakers, organizers)
with an event so they are visible on the event page.

## Protocol research

There is no dedicated "invitation NIP". NIP-52 itself covers both asks:

- A `["p", <pubkey>, <relay>, <role>]` tag on a kind 31922/31923 event
  publicly associates a person with the event; the spec says tagging a pubkey
  "can be interpreted as the calendar event creator inviting that user".
- Kind 31925 RSVPs are explicitly allowed from **any** user, tagged or not.

Other invitation concepts (NIP-43 join/invite requests, NIP-29 group invites,
Marmot Welcome) target relay/group access, not calendar events.

**Design decision:** the two asks use two different mechanisms.

1. **Invitations are private messages**, not event mutations. Writing every
   invitee into the public event is too much — an invite is "here is an event
   I'd like you to attend". We use NIP-17 DMs carrying a `nostr:naddr` link.
2. **Person association is a public, editorial act** by the event owner:
   p-tags with roles, edited in the event form.

## Part 1: Event invitations (NIP-17 DM)

### Flow

- `CalendarEventDetailView` gets an **Invite** button, visible to any
  logged-in user (inviting = sharing; no owner restriction), placed with the
  existing share/RSVP actions.
- It opens a new `InviteToEventModal`:
  - Recipient picker: reuse `ContactSearchInput` (name/nip05/npub), multi-add,
    already-picked recipients excluded.
  - Optional personal-message textarea.
- On send, for each recipient run the existing
  `actionRunnerOptimistic.run(SendWrappedMessage, [recipient], content)` —
  one individual DM per recipient (no group chat). Content:

  ```
  <personal note, if any>

  nostr:naddr1...
  ```

  The naddr comes from `CalendarEventDetailView`, which already generates it
  (kind/pubkey/d plus relay hints) — no new encoding logic.
- Per-recipient failures are shown in the modal with retry; successful sends
  are not rolled back.

### Rendering on the receiving side (mostly already built)

The DM thread already renders message content through `NostrContentRenderer`
→ `NostrIdentifier`, which routes calendar-event naddrs to
`CalendarEventPreview` — a rich card with title, date, location, and a link
to the event page, including loading/not-found fallbacks. **No new parsing
helper and no `ConversationThread` changes are needed.**

The only addition: `CalendarEventPreview` (block variant) gains the existing
`InlineRsvp` component, shown for logged-in users. This lights up inline
RSVP everywhere event links are embedded — DMs, chat, comments, threads —
not just invites. (Note: the preview's parsed event may need its `d` tag
threaded through for `InlineRsvp`/`createRsvp`.)

### Semantics & caveats

- The invitation is an ordinary kind-14 rumor — no marker tag, no custom
  kind. An invite and a casual share are intentionally indistinguishable.
- **The invite is private, but the RSVP is public** (kind 31925 via the
  existing `createRsvp`). This is standard NIP-52 and how attendee lists
  already work.
- Delivery caveats (documented, not solved here): NIP-17 reaches edufeed
  users and other NIP-17 clients (which see text + link); Primal users will
  not see it (legacy kind-4 gap). The known DM relay read/write asymmetry
  applies to invites like any DM.

## Part 2: Person association (p-tags with roles)

### Event form

`CalendarEventModal` gains a **Participants** section (create + edit):

- `ContactSearchInput` to add a person.
- Per person: role dropdown with presets — `speaker`, `organizer`,
  `moderator`, `participant` — plus a "custom…" option revealing a free-text
  field.
- Added participants render as a list: avatar + name + role badge + remove
  button.
- Edit flow prefills from the event's existing p-tags via the existing parser
  (`getCalendarEventMetadata` in `src/lib/helpers/eventUtils.js`).

### Storage & write path

- P-tag shape per NIP-52: `["p", <pubkey>, <relay hint>, <role>]`.
- Preset roles are stored as stable English values and displayed localized
  via Paraglide; custom roles are stored and shown as-is.
- Relay hints via `buildPTagsWithHints` (`src/lib/services/publish-service.js`).
- `buildCalendarEventTags()` (`src/lib/helpers/calendar.js`) learns a
  `participants` field and emits the p-tags.
- `createEvent`/`updateEvent` (`src/lib/stores/calendar-actions.svelte.js`)
  pass participant pubkeys as `taggedPubkeys` to `publishEvent`, so the
  outbox model also publishes the event to each participant's read relays.

### Display

No changes needed — `CalendarEventDetailView` already renders participants
with role badges.

## Simplicity review (DRY/KISS pass)

- Existing infra reused, verified via applesauce MCP: `SendWrappedMessage`
  (`applesauce-actions/actions`) is the send path (3 existing call sites);
  no new parsing needed — `NostrContentRenderer`/`NostrIdentifier` already
  detect naddrs in DM content; `CalendarEventPreview` already loads and
  renders the event card with fallbacks.
- Net new code: one modal, one form section, one `InlineRsvp` placement,
  p-tag emission in `buildCalendarEventTags`. No new services, helpers,
  event kinds, or protocol extensions.
- Rejected simpler alternative: no UI at all ("paste the event link into a
  DM" — the card already renders). Zero code, but fails the discoverability
  ask from the test report.
- Rejected reuse: `ShareByNaddrModal` is the opposite flow (paste naddr →
  community repost), no overlap with DM invites.

## Non-goals (possible follow-ups)

- No inbox notification for being p-tagged on an event ("you were added as
  speaker"). Rejected as the invitation channel; a tag-notice would be a
  separate, later decision.
- No consent/confirmation flow for being p-tagged — it is the organizer's
  editorial act, consistent with other NIP-52 clients.
- No machine-readable invite marker (subject tag / custom kind).

## Testing

Per project TDD policy — unit/component tests preferred, no E2E (every piece
is exercisable below page level; DM sending reuses the already-tested
`SendWrappedMessage` action).

**Unit (Vitest, node):**

- `buildCalendarEventTags` with participants: roles, relay hints, round-trip
  with `getCalendarEventMetadata`.

**Component (Vitest, jsdom):**

- Participants section: add/remove, role select incl. custom, prefill on
  edit.
- `InviteToEventModal`: recipient add/remove/exclusion, per-recipient send,
  failure display.
- `CalendarEventPreview`: shows `InlineRsvp` for logged-in users on a
  resolved calendar event; hidden when logged out / event unresolved.

## Affected files (expected)

| File | Change |
|------|--------|
| `src/lib/components/calendar/CalendarEventDetailView.svelte` | Invite button (naddr already generated here) |
| `src/lib/components/calendar/InviteToEventModal.svelte` | new — ContactSearchInput + note + `SendWrappedMessage` loop |
| `src/lib/components/shared/NostrPreviews/CalendarEventPreview.svelte` | add `InlineRsvp` (block variant, logged-in) |
| `src/lib/components/calendar/CalendarEventModal.svelte` | Participants section |
| `src/lib/helpers/calendar.js` | `buildCalendarEventTags` p-tag support |
| `src/lib/stores/calendar-actions.svelte.js` | pass participants + taggedPubkeys |
| `messages/*.json` | new i18n strings (roles, invite UI) |
