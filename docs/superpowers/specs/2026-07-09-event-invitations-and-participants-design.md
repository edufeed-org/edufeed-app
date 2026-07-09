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

  The naddr encodes kind/pubkey/d plus relay hints (seen relays / calendar
  relays).
- Per-recipient failures are shown in the modal with retry; successful sends
  are not rolled back.

### Rendering on the receiving side

- `ConversationThread` message rendering detects `nostr:naddr` references
  that decode to kind 31922/31923 (pure helper `extractCalendarNaddr`,
  handles the `nostr:` prefix, ignores other kinds and malformed input).
- Matching messages render an event preview card (reuse the existing calendar
  card component) plus the existing `InlineRsvp` buttons beneath the message
  text. The event loads via `addressLoader` with the naddr's relay hints +
  calendar relays.
- If the event cannot be resolved or was deleted, fall back to the plain
  clickable link.
- This applies to **any** DM containing a calendar-event naddr, not only
  invites sent from the modal — casual shares get the same card.

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
- `extractCalendarNaddr(content)`: naddr with/without `nostr:` prefix,
  non-calendar kinds ignored, malformed input, multiple links.

**Component (Vitest, jsdom):**

- Participants section: add/remove, role select incl. custom, prefill on
  edit.
- `InviteToEventModal`: recipient add/remove/exclusion, per-recipient send,
  failure display.

## Affected files (expected)

| File | Change |
|------|--------|
| `src/lib/components/calendar/CalendarEventDetailView.svelte` | Invite button |
| `src/lib/components/calendar/InviteToEventModal.svelte` | new |
| `src/lib/components/dm/ConversationThread.svelte` | event card + inline RSVP for calendar naddrs |
| `src/lib/helpers/calendar-naddr.js` | new — pure `extractCalendarNaddr` helper |
| `src/lib/components/calendar/CalendarEventModal.svelte` | Participants section |
| `src/lib/helpers/calendar.js` | `buildCalendarEventTags` p-tag support |
| `src/lib/stores/calendar-actions.svelte.js` | pass participants + taggedPubkeys |
| `messages/*.json` | new i18n strings (roles, invite UI) |
