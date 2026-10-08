# Publishing to a NIP-29 Group

How events reach a relay-based group (NIP-29) in this app, and why that path
is different from every other publish in the codebase. The implementation
lives in `src/lib/groups/` — this guide maps the moving parts.

## A group lives ON one relay

A NIP-29 group is identified by the pair _(host relay, group id)_ — the
Armada/applesauce pointer format `host'id`, e.g.
`groups.edufeed.org'a1b2c3d4e5f60718`. A bare host means the relay's root
group `_`. Group ids are relay-scoped: the same id on another relay is a
different (usually nonexistent) group, so **every event for a group goes to
exactly one relay — the group's host — and nowhere else.**

Pointer parsing/encoding: `parseGroupInput` / `groupPointerString` in
`src/lib/groups/groups.js` (backed by applesauce-common's
`decodeGroupPointer`).

### Which relay to target

- Deployment default: `GROUPS_RELAYS` env → `runtimeConfig.appRelays.groups`,
  read via `getGroupsRelays()` in `src/lib/helpers/relay-helper.js`. This is
  only the default host offered by the create-group flow; once a group
  exists, its pointer carries the host.
- Deliberately **no** fallback-relay union, no NIP-65 outbox union, and no
  kind-30002 user override — none of those relays host the group.
- The default host `wss://groups.edufeed.org` is an edufeed-patched pyramid
  relay with two behaviors stock NIP-29 relays lack:
  1. **Group creation is whitelist-restricted.** Only accounts the operator
     added as relay members may create groups. The rejection reads
     `restricted: only members of this relay can create a group`; detect it
     with `isRelayMembershipRequired()` (`group-management.js`) and show the
     friendly `community_groups_relay_membership_required` message instead of
     the raw relay text.
  2. **Moderation events must be fresh.** Kinds 9000–9009 whose `created_at`
     is more than 60 s in the past are rejected with `too old` (see the
     re-stamping retry below).

## The `h` tag

Every event published _into_ a group carries the group id in an `h` tag,
conventionally first:

```json
["h", "<group-id>"]
```

One event targets one group. (This is the same tag name the Communikey
community lane uses, but there the value is a community _pubkey_ and the
event goes to community relays — don't mix the two lanes.)

## Event kinds

Kinds the app **publishes to the group's host relay** (all h-tagged):

| Kind         | Purpose                             | Built by                                                                                                                                                                                                               |
| ------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9            | Chat message                        | `buildGroupMessageTemplate` (`groups.js`) — optional NIP-10 marked reply + `p` tag of the replied author (the `p` tag drives mention notifications; always send replies through the template)                          |
| 9450 / 24450 | webxdc pad session state / realtime | `src/lib/webxdc/session-events.js` — scoped `["h", groupId]` + `["i", sessionId]`; the session itself is announced as a kind-9 `imeta` attachment                                                                      |
| 9000         | put-user (add member/roles)         | `buildPutUserTemplate` (`group-management.js`)                                                                                                                                                                         |
| 9001         | remove-user                         | `buildRemoveUserTemplate`                                                                                                                                                                                              |
| 9002         | edit group metadata                 | `buildEditGroupMetadataTemplate` — always emits BOTH marker sides (`public`/`private`, `open`/`closed`) plus `restricted`, so flipping a flag overwrites state; restates the bare `livekit` tag (see Live audio/video) |
| 9007         | create group                        | `buildCreateGroupTemplate` — carries the metadata inline because name-validating relays reject a bare create                                                                                                           |
| 9008         | delete group                        | `buildDeleteGroupTemplate`                                                                                                                                                                                             |
| 9009         | create invite code                  | `buildCreateInviteTemplate` (`code` tag)                                                                                                                                                                               |
| 9021         | join request                        | `buildJoinRequestTemplate` (optional `code` tag)                                                                                                                                                                       |
| 9022         | leave request                       | `buildLeaveRequestTemplate`                                                                                                                                                                                            |

Kinds the app only **reads** — they are generated and signed by the _relay's
own key_, addressed by `d` tag = group id, never published by clients:

| Kind  | Purpose                                          |
| ----- | ------------------------------------------------ |
| 39000 | Group metadata                                   |
| 39001 | Group admins                                     |
| 39002 | Group members                                    |
| 39004 | LiveKit participants (who is in the AV room now) |

Related kinds that do **not** go to the group relay:

- **10009 (personal groups list):** published to the user's own relays via
  the normal outbox path (`updatePersonalGroupsList` in
  `personal-groups-list.js`) — it's what makes joined groups roam across
  devices, and the group relay has no business storing it.
- **11 (forum):** the forum lane belongs to Communikey communities (h-tag =
  community pubkey, community relays). Nothing publishes kind 11 to a NIP-29
  group relay.

## `publishToGroupRelay` vs the normal outbox path

Everything else in the app publishes through `publishEvent()`
(`src/lib/services/publish-service.js`), which fans an event out to a
_union_ of relays: the author's NIP-65 write relays, tagged users' read
relays, the app relays for the kind, and community relays. Group events must
not use it. They go through `publishToGroupRelay(relayConn, template, user)`
in `src/lib/groups/group-management.js`, which differs in four ways:

1. **Single relay.** The event is signed and sent to one
   `pool.relay(url)` connection — the group's host. No union, no fan-out.
2. **NIP-42 auth is handled in-flight.** Some relays challenge on connect
   and silently _hold_ every OK until the client authenticates (measured on
   groups.0xchat.com) — no `auth-required` NAK ever arrives, and applesauce
   surfaces the withheld OK as a `Timeout` NAK after 10 s. The helper
   answers any challenge that appears mid-publish, and retries once after
   authenticating when the NAK is `auth-required` or `Timeout`.
3. **`too old` gets one re-stamp retry.** Templates stamp `created_at` at
   build time, but a slow NIP-46 bunker approval can push the signature past
   the pyramid's 60-second freshness window for moderation kinds. On a
   `too old` NAK the helper re-signs with a fresh `created_at` and retries
   once.
4. **Every other rejection throws** with the relay's reason, so the UI can
   show it (or translate it via `isRelayMembershipRequired`,
   `isMembershipRefusal`, `isAlreadyMemberError`).

## Examples

Sending a chat message (see `GroupChat.svelte` for the full wiring):

```javascript
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { buildGroupMessageTemplate } from '$lib/groups/groups.js';
import { publishToGroupRelay } from '$lib/groups/group-management.js';

const template = buildGroupMessageTemplate(pointer.id, 'hello group', replyTo);
await publishToGroupRelay(pool.relay(pointer.relay), template, {
  pubkey: activeUser.pubkey,
  signer: activeUser.signer
});
```

Creating a group is a three-step handshake — `createGroupOnRelay()` wraps it:
publish the 9007 create, publish a 9002 with the metadata (relays are not
required to honor metadata on the 9007 itself), then confirm the relay
materialized its 39000. A created-but-unconfirmed group is recoverable via
the attach-existing flow.

## Live audio/video (NIP-29 AV spaces)

Calls follow the NIP-29 spec's "Live audio/video (AV) spaces" section — no
NIP-53 rooms, no client-side presence, no per-community operator URL:

1. **Capability.** The relay advertises AV support with HTTP `204` on
   `https://<relay-host>/.well-known/nip29/livekit`. `probeRelayAvSupport()`
   (`src/lib/groups/livekit.js`) checks it (cached per origin, only a positive
   answer is kept) and gates the "Live audio/video" toggle in
   `GroupCreateModal`, `ChannelCreateWizard` and `GroupSettingsSheet`.
2. **Flag.** An AV group carries a bare `["livekit"]` tag on its kind 39000.
   The app writes it through `metadataTags({ livekit: true })`; pyramid
   overwrites the flag from whatever a 9002 carries, so **every** edit
   restates the current value (`GroupSettingsSheet`, `sync-group-metadata.js`).
   Switching AV off is a 9002 without the tag.
3. **Token.** `requestGroupCallToken(relay, groupId, user)` GETs
   `https://<relay-host>/.well-known/nip29/livekit/<group-id>` with
   `Authorization: Nostr <base64 kind-27235>` whose `u` tag is that exact URL
   (`createNIP98AuthHeader`, method `GET`, no payload). The relay answers
   `{ "server_url", "participant_token" }`; group members get a publishing
   token, non-members of a public group a listen-only one (`canPublish` on
   the connection service), non-members of a private group a 403. The
   `.well-known` paths hang off the relay **origin** — a community pointer's
   `/c/<rootId>` path is stripped (`relayHttpOrigin`).
4. **Identity.** The JWT identity is `<64-hex pubkey>:<random>`; one user may
   sit in the room twice. `identityToPubkey()` takes the first 64 chars; tiles
   are keyed by LiveKit `sid`.
5. **Presence.** The relay's LiveKit webhook republishes kind 39004 (`d` =
   group id, one `participant` tag per pubkey). `useCallPresence(getPointer)`
   (`call-presence.svelte.js`) keeps a standing subscription pinned to the
   relay's NIP-11 key, exactly like the 39000 reader — the header count in
   `GroupChat` and the "who's in the call" roster under an AV channel in the
   channel lists (`ChannelCallRoster`) come from there.
6. **In-call signals.** Raise hand and reactions are LiveKit data messages
   (reliable, topic `edufeed.call`, JSON `{t:'hand', v}` / `{t:'react', e, n}`,
   emoji from a fixed allowlist), not Nostr events: NIP-29 has no client
   presence plane and the SFU already reaches exactly the people in the call.
   A raised hand is re-sent to each late joiner. They need `canPublishData`
   on the token.
7. **Enabling from the channel.** An admin of a non-AV channel on a relay
   whose probe answers 204 gets a one-click "Start call" in the header
   (`enable-group-calls.js`): a 9002 that restates every field of the current
   39000 plus `livekit`, then the join.

`group-call.svelte.js` owns the single active call app-wide, **including the
LiveKit connection**: the call outlives the channel view. The in-call UI,
`components/groups/call/GroupCallStage.svelte`, is a pure view mounted in the
same stage slot a shared webxdc app uses; it registers itself with the store,
and while no stage is registered (other channel, other page, or the user
stepped back to the chat) the root layout shows `CallDock`. Remote audio is
attached once, centrally, by the connection service, never by tiles. Stage and
dock are loaded lazily so `livekit-client` never enters a route's static graph.

## Guest links (call passes)

A member of a live AV channel can mint a **call pass** (kind 9025,
`docs/nips/nip29-call-passes.md`) and hand out `/call/<group pointer>#<code>`
(`src/lib/groups/call-passes.js`). The code lives in the URL fragment, never
a query param, so it never reaches a server log or `Referer` header. Only a
member can create (`createCallLink`) or revoke one — author via NIP-09 kind
5, moderator via NIP-29 kind 9005 (`revokeCallPass`), both through
`publishToGroupRelay`. The holder's NIP-98 token request carries the
plaintext code as `["code", <code>]` in the signed event, never the URL; a
403 `call pass <reason>` maps to the `'pass'` failure reason in
`group-call.svelte.js`. `CallInviteDialog.svelte` offers the link, and
`/call/<pointer>` (`CallLanding.svelte`) lets a guest join, only once the
relay's pass-check endpoint (`GET …/livekit/<group-id>/pass/<code-hash>`)
answers JSON for the channel — no separate feature flag. Guests get a token
with metadata `{"guest":true,"pass":"<id>"}` but never a 9000/9021: they
never join the roster, so member counts/lists are untouched and call tiles
show a "Gast" badge instead. Calls also carry an ephemeral LiveKit-data chat
(topic `edufeed.call.chat`) separate from the group's normal "Kanal" chat,
which guests never see.

**Host and co-host.** The relay decides who hosts a call (the meeting's
author, else whoever opened the room; co-hosts from the meeting's `p`-tag
roles or promoted in the call — "Host and co-host" in
`docs/nips/nip29-call-passes.md`) and writes it into participant metadata.
`participantCallRole()` (`livekit.js`) reads it the way `isGuestParticipant`
does; the stage shows "Host"/"Co-Host" badges on tiles and rows and the
viewer's own role in the header. Host actions (mute, stop camera, stop
screen share, remove, make/revoke co-host) sit in the participant list's
row menu (`CallHostActions.svelte` via the panel's `menuExtras`) and go
through `moderateActiveCall()` (`group-call.svelte.js`) →
`moderateCall()`, a NIP-98 POST to `…/livekit/<group-id>/moderate`; the
relay does the work with its admin token. A server-side mute reaches the
muted client as `TrackMuted` on its own publication; the connection service
keeps `isMuted`/`isCameraOff` truthful and turns a muted screen share into a
stopped one. The meeting dialog's participant picker offers a per-person
"Co-Host" switch (`ParticipantsEditor` `cohostToggle`, `meeting-roles.js`)
that writes the `p`-tag role.

## Scheduled meetings

A channel meeting is a NIP-52 kind 31923 event with **exactly one**
`["h", <group-id>]` tag (never a community-pubkey `h` on the same event),
published through `publishToGroupRelay` to the channel's group relay only —
never the outbox. `location` is always the channel's member link, never a
pass code. `src/lib/groups/meetings.js` (`buildMeetingTags`,
`meetingCoordinate`, `meetingPhase`, `isChannelMeeting`) and
`src/lib/groups/schedule-meeting.js` (`scheduleGroupMeeting`,
`sendMeetingInvites`) own the tag/window logic; `CalendarEventModal`'s
"group meeting" mode is the only entry point for creating one.

**Editing** ("Bearbeiten" on the `MeetingCard`, author only — a moderator
cannot re-sign someone else's addressable event) reopens that same dialog
in group-meeting edit mode (`GroupChat.openEditMeeting` passes
`mode: 'edit'`, the raw 31923 as `existingRawEvent` and the meeting's pass
as `groupMeeting.guestPass`). `updateGroupMeeting`
(`src/lib/groups/edit-meeting.js`) re-publishes the **same d-tag** with a
newer `created_at` through `publishToGroupRelay` — the group relay only,
never `calendarActions.updateEvent` (which would fan a private channel's
meeting out to the outbox/calendar relays; the dialog refuses a channel
meeting on that path as defense in depth). On a reschedule it also:

- keeps an already-shared guest link working: the relay freezes the pass
  window at mint time, so `renewMeetingLink` (`call-passes.js`) publishes a
  new 9025 with the **same code** (read from the old pass's self-encrypted
  content) and the new window, then revokes the old one — the URL in
  everyone's hands stays valid (see "Meeting passes" in
  `docs/nips/nip29-call-passes.md`);
- posts a "Termin verschoben" notice into the channel as an ordinary kind-9
  message (`buildGroupMessageTemplate`), old → new time;
- DMs every invited pubkey the same notice (`notifyMeetingChange`; newly
  added invitees get the invitation instead).

Switching the guest toggle on/off in the edit dialog mints/revokes the pass;
a meeting moved beyond the relay's 60-day pass limit has its pass revoked
(`guestStatus: 'too_far'`). The card's `.ics` keeps its UID (the meeting
coordinate) and stamps `SEQUENCE`/`LAST-MODIFIED` from the event's
`created_at`, so a calendar that already imported the meeting replaces its
entry on re-import instead of adding a second one.

A guest link, when the organiser turns it on, is a meeting pass — see
"Meeting passes" in `docs/nips/nip29-call-passes.md` — minted via
`createMeetingLink` (`call-passes.js`). The relay only mints passes for AV
groups, and a community's General channel (its root group) starts without
the `livekit` tag: the dialog still offers the toggle to an admin who may
switch calls on (`canEnableCalls`, the same gate as the one-click "Start
call"), and `scheduleGroupMeeting` runs `enableGroupCalls` right before
minting; a plain member is told that an admin has to switch calls on in
the channel settings first. Invites are NIP-17 DMs
(`sendWrappedDm`), one per invited pubkey, naming the meeting and the
channel link; the guest link is included only for invitees who are not
already on the channel roster (everyone gets it when the roster is
unknown).

`GroupChat.svelte` renders each 31923 as a `MeetingCard` (status, ".ics",
the author's "Gast-Link kopieren" and "Bearbeiten", delete) and shows a `MeetingBar` above
the timeline for the next joinable/upcoming meeting. Joining goes through
`confirmCallSwitch` (`call-switch-confirm.svelte.js`) when the user is
already live in another channel's call.

The community calendar reads these events too: `channelCalendarsLoader`
(`src/lib/loaders/calendar.js`) opens one `#h` REQ per channel (not one per
relay), so a relay closing the REQ for a channel the user can't read never
hides another channel's meetings; see "Channel calendars" in
`docs/nips/communikey-groups.md`.

Channel meetings are deliberately invisible everywhere a generic NIP-52
event would otherwise show up: `isChannelMeeting` /
`withoutChannelMeetings` (`src/lib/helpers/calendar-timing.js`) keep them
out of the personal/discover/community-feed calendar models and loaders,
the dashboard upcoming/activity lists, the profile events tab, link
previews, the map view, the generic edit/delete/share/RSVP actions, and the
IDB event cache (never written, and dropped on read as a migration guard).
Deleting a meeting (`deleteMeeting`, `meeting-actions.js`) revokes every
call pass whose `a` tag names it — via `listCallPasses` +
`revokeCallPass` — **before** signing the kind 5/9005 deletion, so a
deleted meeting never leaves a working guest link behind.

## Key files

| File                                     | Role                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/lib/groups/groups.js`               | Pointer parsing, chat/join/leave templates, 10009 list template                                     |
| `src/lib/groups/group-management.js`     | Moderation templates (9000–9009), `publishToGroupRelay`, `createGroupOnRelay`, error classifiers    |
| `src/lib/groups/relay-auth.js`           | NIP-42 `authenticateOnce`                                                                           |
| `src/lib/groups/personal-groups-list.js` | Kind-10009 updates (outbox, not group relay)                                                        |
| `src/lib/helpers/relay-helper.js`        | `getGroupsRelays()`                                                                                 |
| `src/lib/webxdc/session-events.js`       | Pad session kinds 9450/24450                                                                        |
| `src/lib/groups/livekit.js`              | NIP-29 AV: relay probe, NIP-98 token request, `livekit` tag + identity helpers                      |
| `src/lib/groups/call-presence*.js`       | Kind-39004 filter/parser and the relay-key-pinned live subscription                                 |
| `src/lib/groups/group-call.svelte.js`    | The single active call (token round-trip, which channel it belongs to)                              |
| `src/lib/groups/call-passes.js`          | Guest call passes: code/hash/link helpers, pass check, create/renew/list/revoke                     |
| `src/lib/groups/meetings.js`             | Scheduled-meeting tags/window/phase helpers, `isChannelMeeting` guard, `.ics` builder               |
| `src/lib/groups/schedule-meeting.js`     | `scheduleGroupMeeting`, `sendMeetingInvites` (NIP-17 invites + guest link)                          |
| `src/lib/groups/edit-meeting.js`         | `updateGroupMeeting` (same d-tag, group relay only), reschedule notice + invitee DMs                |
| `src/lib/groups/meeting-actions.js`      | `deleteMeeting` — revokes the meeting's passes, then deletes it                                     |
| `src/lib/helpers/calendar-timing.js`     | `isChannelMeeting` / `withoutChannelMeetings` (pure; used by the cache and generic calendar models) |
| `src/lib/loaders/calendar.js`            | `channelCalendarsLoader` — one `#h` REQ per channel for the community calendar                      |
