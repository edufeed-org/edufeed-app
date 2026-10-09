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

### Walking into one

A **member of the parent group** may take a seat in one of its ephemeral
children by themselves: a codeless kind 9021 (join-request) to the child
from a member of the parent MUST be auto-admitted like a valid-code join
(the relay publishes the put-user; the child's kind 39002 then names
them). The host's client may sit in another child, out of reach of the
parent room's data channel, so a request parked in the child's pending
queue would reach nobody. Inside an ephemeral child a kind 9001 is the
host moving someone out, not a ban: it MUST NOT block that member's later
9021 to the same child. Strangers still land in the pending queue, as for
any closed group. (pyramid edufeed-v1.18.)

Clients: a seat in the parent's room that a child's roster now names SHOULD
treat that as its assignment (ask, or switch at once when it knocked on
that child itself), so the host can seat people from any room through the
relay alone. A host's client in a child SHOULD follow the parent's kind
39004 to see who waits in the parent's room.

A host may keep the assignment to themselves: the rooms' `about` marker
then carries `join=host` (and the host's `{t:'state'}` message
`selfJoin: false`). Clients SHOULD then tell a late joiner only that a
session runs, list no rooms, and not knock; the host seat answers no join
request. The relay still admits a member's 9021 — this is a client-side
courtesy, not access control.

### How one ends

The relay deletes an ephemeral group **itself** — a relay-signed kind 9008
through the same path as a user's 9008 (events archived, id blocked) —
and tears down its LiveKit room (RoomService `DeleteRoom`) when any of
these happens:

| trigger       | when                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| room finished | the LiveKit `room_finished` webhook fires for the group (the last seat left or returned)                                               |
| never started | 15 minutes after creation without a LiveKit room having started                                                                        |
| deadline      | `until` + 5 minutes grace has passed, whether or not the room is in use                                                                |
| parent gone   | the parent group is deleted; ephemeral children are deleted first                                                                      |
| sweep         | on relay start and from a periodic sweeper (edufeed: every minute) that re-checks the rules above, as a safety net for missed webhooks |

A relay MAY delete an ephemeral group earlier when its parent's call ends
(`room_finished` of the parent) and nobody is in the ephemeral room.

**The parent's call runs on in its ephemeral children.** Whenever everyone
— the host included — sits in breakout rooms, the parent's own LiveKit
room is empty and finishes, but the call is not over. Relays MUST treat the
parent's call as running while the parent's room or any of its ephemeral
children holds a seat: a `room_finished` of the parent's own room while a
child is in use MUST NOT delete the parent's call-scoped passes
(`nip29-call-passes.md`), clear its call host / co-host roles, or start the
"parent call ended" clock of its children, and a call-scoped pass of the
parent stays valid for token requests on the parent and its children
meanwhile. The call ends — passes deleted, roles cleared, the clock started
— once the parent's room and every child's room have finished.

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

### Implementation notes (pyramid edufeed-v1.12)

- The `#ephemeral` request MUST name `"kinds":[39000]`: pyramid's store
  indexes single-letter tags only and post-filters a multi-letter tag while
  walking the kind index, so a `#ephemeral` filter without `kinds` returns
  nothing.
- "Started" means a LiveKit room exists for the group: a token minted by the
  relay or a participant webhook marks it; after a restart the sweeper asks
  LiveKit once per unknown room. When LiveKit is unreachable the
  never-started rule is skipped for that group; the other triggers still
  apply.
- "Admin of the parent" means a moderation role there (admin or moderator),
  not the publisher role.
- A 9007 MAY carry `ephemeral` and `until` itself (atomic creation); the
  9007-then-9002 shape works too, the first applied 9002 may set them.
- `until` on a non-ephemeral group is refused; `["until",""]` clears a
  deadline. Restating the same `ephemeral` value is accepted, any change or
  removal is refused.
- The relay-signed 9008 carries the reason in `content` (`call finished`,
  `call never started`, `deadline passed`, `parent group deleted`).
- The optional "parent room finished and child empty" rule is NOT
  implemented: when everyone moves into breakout rooms the parent room
  empties, which would delete rooms people are about to enter.

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

## Guests in ephemeral children

A call guest (someone who joined through a call pass,
`nip29-call-passes.md`) is not a member of the parent group and can never
be seated in an ephemeral child with put-user: a pass grants a seat in the
call, not membership, and a put-user would turn the guest into a member of
the child. Instead the **pass itself** reaches the children (relay side
pyramid `edufeed-v1.13`).

### Relay rules

- A pass issued for group P MUST be honoured on a token request for any
  ephemeral child of P. The relay resolves the `code` against the child's
  own passes first, then the parent's. A pass found on the parent is judged
  against the **parent**: its `not-before` / `expiration` window, its
  author's membership of the parent, revocation, and for `scope=call` the
  parent's call running — never the child's.
- A pubkey removed from the parent (its newest kind 9001 there is not a
  self-removal) MUST be refused in every child too, with the same
  `call pass blocked: you were removed` answer.
- The guest's seat in the child carries the same participant metadata as in
  the parent, `{"guest":true,"pass":"<pass event id>"}`. Guests are never
  roster members of any group; the child's kind 39002 does not list them.
- Revoking the parent's pass (the author's kind 5, a moderator's kind 9005)
  and the parent's call ending (for call-scoped passes) MUST disconnect
  that pass's guests from every child room as well as from the parent.
  Deleting a child tears down its LiveKit room, which disconnects the
  guests in it like everyone else.
- The pass check `GET /.well-known/nip29/livekit/<child-id>/pass/<hash>`
  MUST answer for the parent's pass exactly as the parent's own endpoint
  would.

A relay without this rule refuses the child token request with its usual
`403 call pass unknown`; a client then leaves the guest in the parent's
call and says so.

### Client rules

- A client MUST assign a guest **by message only** — the
  `edufeed.call.breakout` data message (`{t:'assign', …}`) names the
  guest's seat identity like a member's — and MUST NOT publish a kind 9000
  for a guest identity.
- The guest's client joins the child with the **same `code`** it joined the
  parent with (the `["code", …]` tag on the NIP-98 token request) and
  returns to the parent with that code again. Mic, camera and background
  effect are kept across the switch like a member's.
- Before leaving the parent's call for a child, the guest's client SHOULD
  request the child token while it is still connected to the parent and
  tell the host seat which identity it will hold there:
  `{t:'seat', room: <child id>, identity: <the token's identity>}` on the
  breakout topic. The token's `sub` is the identity; a host needs it for
  the moderation endpoint, which matches identities exactly, while the
  child's kind 39004 lists pubkeys only. Clients MUST believe a `seat` only
  from a guest seat (`{"guest":true}` metadata) whose pubkey matches the
  announced identity.
- In a child the guest's client cannot follow a roster (it is on none). It
  MUST follow the child's kind 39000 by `#d` for `until` and deletion, the
  kind 9008, and the LiveKit disconnect that follows the relay's
  `DeleteRoom`; all of these mean "return to the parent". Being **removed**
  from an ephemeral child by moderation also means "return to the parent"
  (that is how a host moves a guest), never the "removed from the call" end
  state; a removal from the parent itself stays final.
- The guest's client SHOULD subscribe to the parent's kind 20002 while in a
  child like a member's, and MUST ignore a relay's refusal silently: a
  broadcast reaches guests only where the parent group is readable to
  non-members (a public parent). A private parent's broadcasts do not
  reach its guests.
- The host moves a guest out of a room with the moderation endpoint's
  `remove` on the **child** (`POST …/livekit/<child-id>/moderate`, the
  identity from the guest's `seat`); the guest's client returns to the
  parent on its own, and the host's client then re-assigns it by message
  once the guest's new seat appears in the parent's room. "Back to the main
  room" for a guest is the `remove` alone. A guest still in the parent's
  room is moved by a targeted `assign` only.

## Why relay-side

The host's client is the only party that knows a session exists, and it
can vanish at any moment (tab closed, laptop lid, network). Whatever a
client promises to clean up, it cannot promise to be there. The relay sees
every room's LiveKit lifecycle through the webhooks it already consumes for
the participant list, so it is the one place where "a room nobody is in any
more goes away" can be guaranteed.
