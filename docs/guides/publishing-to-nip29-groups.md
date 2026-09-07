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

| Kind         | Purpose                             | Built by                                                                                                                                                                                      |
| ------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9            | Chat message                        | `buildGroupMessageTemplate` (`groups.js`) — optional NIP-10 marked reply + `p` tag of the replied author (the `p` tag drives mention notifications; always send replies through the template) |
| 9450 / 24450 | webxdc pad session state / realtime | `src/lib/webxdc/session-events.js` — scoped `["h", groupId]` + `["i", sessionId]`; the session itself is announced as a kind-9 `imeta` attachment                                             |
| 9000         | put-user (add member/roles)         | `buildPutUserTemplate` (`group-management.js`)                                                                                                                                                |
| 9001         | remove-user                         | `buildRemoveUserTemplate`                                                                                                                                                                     |
| 9002         | edit group metadata                 | `buildEditGroupMetadataTemplate` — always emits BOTH marker sides (`public`/`private`, `open`/`closed`) plus `restricted`, so flipping a flag overwrites state                                |
| 9007         | create group                        | `buildCreateGroupTemplate` — carries the metadata inline because name-validating relays reject a bare create                                                                                  |
| 9008         | delete group                        | `buildDeleteGroupTemplate`                                                                                                                                                                    |
| 9009         | create invite code                  | `buildCreateInviteTemplate` (`code` tag)                                                                                                                                                      |
| 9021         | join request                        | `buildJoinRequestTemplate` (optional `code` tag)                                                                                                                                              |
| 9022         | leave request                       | `buildLeaveRequestTemplate`                                                                                                                                                                   |

Kinds the app only **reads** — they are generated and signed by the _relay's
own key_, addressed by `d` tag = group id, never published by clients:

| Kind  | Purpose        |
| ----- | -------------- |
| 39000 | Group metadata |
| 39001 | Group admins   |
| 39002 | Group members  |

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

## Key files

| File                                     | Role                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/lib/groups/groups.js`               | Pointer parsing, chat/join/leave templates, 10009 list template                                  |
| `src/lib/groups/group-management.js`     | Moderation templates (9000–9009), `publishToGroupRelay`, `createGroupOnRelay`, error classifiers |
| `src/lib/groups/relay-auth.js`           | NIP-42 `authenticateOnce`                                                                        |
| `src/lib/groups/personal-groups-list.js` | Kind-10009 updates (outbox, not group relay)                                                     |
| `src/lib/helpers/relay-helper.js`        | `getGroupsRelays()`                                                                              |
| `src/lib/webxdc/session-events.js`       | Pad session kinds 9450/24450                                                                     |
