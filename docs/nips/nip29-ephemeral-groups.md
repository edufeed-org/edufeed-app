# NIP-29 extension: ephemeral groups and call broadcasts

`draft` `optional` — proposed for edufeed-app and the edufeed pyramid fork
(relay side planned for `edufeed-v1.12`); supersedes the `about` marker the
first breakout-rooms implementation used.

A call sometimes needs short-lived side rooms: breakout rooms of a
channel's video call. In NIP-29 terms each such room is a group of its own,
because a LiveKit room is bound to one group and the relay mints a token
only for members of that group. Left to clients, such groups outlive the
call whenever the person who created them disappears. This extension lets a
client declare a group **ephemeral** and makes the **relay** responsible
for its end of life, and it adds a tiny ephemeral event so a call host can
address everyone in those rooms at once.

## Ephemeral groups

### Declaring one

An ephemeral group is created like any other group (kind 9007, then kind
9002 with its metadata). Its metadata carries:

```jsonc
["ephemeral", "<parent group id>"],  // required: the group this one belongs to
["until", "<unix seconds>"]          // optional: the session's planned end
```

together with the usual `name`, `livekit`, `hidden`, `closed` and
`restricted` tags. `parent` MAY be present as well (NIP-29 subgroup); the
`ephemeral` tag is what the relay acts on, so a client that is not allowed
to set `parent` (pyramid requires a role in the parent for that) still gets
an ephemeral group.

Relays MUST:

- accept the `ephemeral` tag only from an account that may create groups
  on this relay, and only when the named parent exists, is not ephemeral
  itself, and the creator is a member of the parent (kind 39002 or 39001);
- store the tag and restate `ephemeral` and `until` verbatim on the group's
  kind 39000, so every reader can tell an ephemeral group apart (pyramid
  regenerates 39000 from its own state, which is why a tag it does not
  know disappears today);
- refuse a metadata edit that adds, removes or changes `ephemeral` after
  creation; `until` MAY be changed by anyone who may moderate the group
  (see below);
- cap ephemeral children per parent (edufeed: 16) and refuse the creation
  of more with a reason, so a misbehaving client cannot accumulate rooms.

Clients SHOULD name ephemeral groups so humans understand them
("Breakout 2 · Seminar") and SHOULD create them `hidden`, so they stay out
of broad listings, and `closed`+`restricted`, so only the seats the host
assigns may enter.

### Who may moderate one

For an ephemeral group the relay accepts kind 9000 (put-user), 9001
(remove-user), 9002 (edit-metadata, `until` only) and 9008 (delete-group)
from any of:

- the group's creator (as today, the relay seats the creator as admin);
- an admin of the parent group;
- the parent group's **current call host or co-hosts** (the seats the relay
  marks with `{"host":true}` / `{"cohost":true}` in the parent's LiveKit
  participant metadata, see the call-pass spec, "Host and co-host").

Everyone else is refused as for a normal group. This is what lets a co-host
who inherited the host seat move people and end a session that someone
else started.

### How one ends

The relay deletes an ephemeral group **itself** — a relay-signed kind 9008
through the same path as a user's 9008 (events archived, id blocked) —
and tears down its LiveKit room (RoomService `DeleteRoom`) when any of
these happens:

| trigger | when |
|---|---|
| room finished | the LiveKit `room_finished` webhook fires for the group (the last seat left or returned) |
| never started | 15 minutes after creation without a LiveKit room having started |
| deadline | `until` + 5 minutes grace has passed, whether or not the room is in use |
| parent gone | the parent group is deleted; ephemeral children are deleted first |
| sweep | on relay start and from a periodic sweeper (edufeed: every minute) that re-checks the rules above, as a safety net for missed webhooks |

A relay MAY delete an ephemeral group earlier when its parent's call ends
(`room_finished` of the parent) and nobody is in the ephemeral room.

Clients that are in an ephemeral group's call MUST treat the group's
deletion (its kind 39000 answered as deleted, a 9008 seen live, or the
LiveKit disconnect that follows `DeleteRoom`) as "return to the parent".
Clients SHOULD still delete rooms themselves when a host ends a session,
so people are not kept waiting for the sweeper.

### Reading

An ephemeral group's 39000 is served to anyone who may read the parent's
39000 (members of the parent), even though the group is `hidden`, so that a
late joiner of the parent's call can discover the running session: a
request for `{"kinds":[39000], "#ephemeral":["<parent id>"]}` MUST return
the parent's current ephemeral children to members of the parent. (This is
the one place where `hidden` is relaxed; the rooms are still absent from
unfiltered listings.)

## Call broadcasts (kind 20002)

A host wants to tell every room something ("two minutes left", "come back
for the wrap-up"). The rooms are separate LiveKit rooms, so a data message
does not reach them; a kind 9 message would show up as chat for every
client. Instead the host publishes an **ephemeral event** to the relay,
addressed to the parent group:

```jsonc
{
  "kind": 20002, // ephemeral: relayed, never stored
  "content": "<text>",
  "tags": [
    ["h", "<parent group id>"],
    ["type", "message"] // "message" | "countdown" | "return"
  ]
}
```

- `message`: free text from the host, shown to everyone in the parent's
  call and in each ephemeral child's call.
- `countdown`: `content` is the number of seconds left until `until`;
  clients SHOULD send it automatically at 300, 120 and 60 seconds and
  readers update their deadline display rather than toasting each one.
- `return`: a heads-up that the host is about to end the session;
  `content` MAY carry a short text.

Relays MUST accept kind 20002 only from the parent group's current call
host or co-hosts, or an admin of the parent, carrying exactly one `h` tag,
and MUST NOT store it. Clients in an ephemeral child subscribe to
`{"kinds":[20002], "#h":["<parent id>"]}` for the duration of their stay.
Clients SHOULD render a broadcast as a toast naming the sender and as a
system line in the room's call chat, so people who missed the toast still
see it.

## Why relay-side

The host's client is the only party that knows a session exists, and it
can vanish at any moment (tab closed, laptop lid, network). Whatever a
client promises to clean up, it cannot promise to be there. The relay sees
every room's LiveKit lifecycle through the webhooks it already consumes for
the participant list, so it is the one place where "a room nobody is in any
more goes away" can be guaranteed.
