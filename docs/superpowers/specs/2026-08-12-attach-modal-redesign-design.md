# Attach-Modal Redesign — „Gruppe verknüpfen"

**Date:** 2026-08-12
**Branch:** `feat/community-group-pointer`
**Motivation:** laoc (2026-08-12): the current AreaAttachModal (protocol tabs,
`host'id` address input, access dropdown with a "labels only the row"
disclaimer) is incomprehensible to anyone outside Nostr.

## Fixed context (do not relitigate)

- Categories, not protocols (buzz design thread): „Verschlüsselte Gruppe" /
  „Geschlossene Gruppe" / „Weltoffene Gruppe". A protocol name appears at
  most once, small.
- XOR rule: one community has ONE protected area — Concord or NIP-29, decided
  by `attachableAreaModes(communikeyEvent)`. Once one side is taken, only
  siblings of that side can attach.
- Creating channels is the wizard's job (`ChannelCreateWizard`); this modal
  is ONLY "link something that already exists".
- The pointer's access slot (`members` | `invited`) records community intent
  for private NIP-29 channels: Stufe-2 fan-out inclusion + disclosure
  wording. It cannot be read from the relay.

## Design

### 1. One picker, no protocol tabs

The modal becomes a single list titled **„Gruppe verknüpfen"**, lead:
„Verbinde eine bestehende Gruppe mit dieser Community. Sie erscheint dann
als Kanal." The protocol-choice tabs and the `protocol-notice` disappear:
picking an entry implies the protocol.

**Candidate list** = everything the app already knows that this community can
still take:

- unlinked Concord areas (existing `useUnlinkedConcordAreas` source), when
  `modes.concord`
- the user's NIP-29 groups (kind-10009 public entries, existing
  `useUnlinkedGroups` metadata plumbing) that are not already a channel of
  THIS community (compare by `channelKey`), when `modes.group`

**Row shape:** glyph (🔒 / # / #🌐) + group name + category subtitle:

| Kind | Subtitle |
| --- | --- |
| Concord area | Verschlüsselte Gruppe |
| NIP-29, private | Geschlossene Gruppe |
| NIP-29, world-readable | Weltoffene Gruppe |

World-readable detection reuses `channelAccessLevel` on the group's kind-39000
(the same rule the rail uses). Selecting a row + „Verknüpfen" attaches via the
existing `attachGroupChannel` / Concord attach paths — the backend dispatch
does not change.

**Empty list:** „Du bist noch in keiner Gruppe, die sich hier verknüpfen
lässt." plus the paste link (§2).

### 2. Paste fallback with preview

Below the list, a quiet text link: **„Gruppe von woanders verknüpfen"** →
reveals one input. Accepted spellings (liberal parse, extending
`parseGroupInput`): `host'id`, `wss://host'id`, and `https://host'id` /
`http://host'id` (scheme mapped to wss); surrounding whitespace trimmed.
Anything else is unparseable — no guessing inside arbitrary URLs.

On a valid parse the modal fetches the group's kind-39000 from the host and
shows a **preview card** — name, picture, category subtitle (incl. weltoffen
badge) — and only then activates „Verknüpfen". No blind attach.

Error states, plain language:

- unparseable input: „Das sieht nicht wie eine Gruppen-Adresse aus."
- parseable but no 39000 within timeout: „Unter dieser Adresse wurde keine
  Gruppe gefunden." (retry allowed by editing the input)

The preview fetch goes through the group relay directly (same connection
door as `confirmGroupMetadata`), with the existing NIP-42 auth-retry
behavior.

### 3. Access question only when it means something

- Concord area selected → no question (Concord manages its own membership).
- World-readable NIP-29 group → no question; the pointer is written without
  an access marker (matches the wizard's weltoffen behavior).
- Private NIP-29 group → the SAME two radios the channel wizard shows,
  reusing the wizard's i18n keys verbatim („Alle in dieser Community" /
  „Nur ausgewählte Mitglieder", with their existing subtitles). Default:
  „Nur ausgewählte Mitglieder" (the safe tier). The dropdown and its
  disclaimer text are deleted.

### 4. Out of scope (YAGNI)

- Admin-rights badge per row (needs a 39001 fetch per candidate; the owner
  knows their groups)
- Discovery/search of foreign relays
- Changes to the settings-card entry point, the create wizard, or the
  first-time area choice framing
- A later "flip access tier" UI (still deferred, as before)

## Error handling

Attach failures keep today's behavior (loud toast, no silent partial
states). Preview fetch failures never block the list path — they only gate
the paste path's confirm.

## Testing

- **Unit:** candidate-list assembly (XOR filtering, already-linked exclusion
  by `channelKey`, category mapping); liberal address parsing incl. URL
  forms and garbage; access-question visibility rules (concord/weltoffen/
  private matrix).
- **Component:** picker renders rows with category subtitles; paste link
  reveals input; preview renders after mocked metadata fetch and gates the
  confirm; private NIP-29 selection shows the wizard's radios; confirm
  dispatches the right attach call per kind (mocked).
- No new E2E; live check against the 0xchat sandbox at the end.
