# NIP-29 AV extension: call passes

`draft` `optional` — implemented by the edufeed pyramid fork; proposed upstream.

A member of a NIP-29 group with live audio/video (a `livekit` tag on its
kind 39000) can issue a **call pass**: a secret code that lets its holder
join the group's call with full rights (audio, video, screen, data) without
becoming a group member. Relays and clients that do not implement this are
unaffected.

## Pass event (kind 9025, provisional)

```jsonc
{
  "kind": 9025,
  "content": "<NIP-44 ciphertext of the code, encrypted to the author's own pubkey>",
  "tags": [
    ["h", "<group-id>"],
    ["code-hash", "<sha256 hex of the code>"],
    ["expiration", "<unix seconds>"], // NIP-40, required
    ["not-before", "<unix seconds>"], // optional
    ["scope", "call"], // optional
    ["a", "31923:<pubkey>:<d>", "<relay>"], // optional: the NIP-52 meeting it belongs to
    ["title", "<label>"] // optional: author-chosen name for the link
  ]
}
```

- The code SHOULD carry at least 128 bits of randomness. Only its hash is
  public; the self-encrypted content lets the author's other devices rebuild
  the link.
- `scope=call`: the pass is valid only while the group's call is running and
  the relay deletes it when the call ends. A relay MUST reject a `scope=call`
  pass while no call is running, MUST reject one whose `expiration` is more
  than 12 hours ahead, and SHOULD delete call-scoped passes when the call's
  participant list becomes empty, besides on room end.
- `title`: an optional label the author picks ("Parents' evening") so
  management UIs can tell several links apart. It is readable only by those
  who can read the pass (see below), never by the link's holder, and clients
  SHOULD keep it short (edufeed caps it at 80 characters).

Relays MUST accept a pass only

- from a member of the group (kind 39002 or 39001) of a group with live
  audio/video,
- carrying exactly one `h` tag (a relay resolves a group event by its first
  `h` tag but matches a `#h` query against any of them, so a second `h`
  would let a pass reach a group it was never authorized for),
- with an `expiration` in the future and within the relay's maximum
  lifetime,

and SHOULD cap the number of active passes per group. A relay counts only
unexpired passes against that cap and MAY delete expired passes whenever it
comes across them. A relay SHOULD refuse to accept again, verbatim, a pass
it has just deleted.

Relays SHOULD show pass events only to their author, to the group's
moderators and to the relay's own administrators (roots), and MUST NOT
serve them through any other channel, such as a search index, that bypasses
this restriction.

## Using a pass

The NIP-98 token request to `/.well-known/nip29/livekit/<group-id>` carries
the code in the signed event:

```json
["code", "<code>"]
```

- A requester who is a member is treated as before; the code is ignored.
- A non-member with a valid code (`not-before <= now < expiration`, for
  `scope=call` a running call, and an author who is still a member of the
  group) receives a full token, also for private groups. The call is all
  that is granted: reading the group's events remains governed by
  membership.
- A pass stops working as soon as its author is no longer a member of the
  group: from then on it reads as `unknown`.
- A non-member with an unusable code receives `403` with body
  `call pass <reason>`.
- A pubkey that was removed from the group (its newest kind 9001 in the
  group is not a `self-removal`) receives `403` with body
  `call pass blocked: you were removed`, whoever's code it presents.
- Guest tokens carry participant metadata `{"guest":true,"pass":"<pass event id>"}`.
- Guest tokens are short-lived (5 minutes on the reference relay). A
  connected client keeps receiving refreshed tokens from LiveKit itself;
  the short lifetime bounds how long a revoked guest could reconnect with a
  token it already holds, since LiveKit does not invalidate a token when it
  removes the participant. Member and listener tokens are unchanged.

## Revocation and expiry

- The author revokes a pass with a NIP-09 deletion, a moderator with a
  NIP-29 kind 9005. The relay then removes every call participant whose
  metadata names the pass.
- The revoking kind 5 SHOULD carry the pass's `h` tag. A relay MUST apply
  the rules below to any kind 5 that targets a stored pass, with or without
  an `h` tag.
- The revoking connection MUST be NIP-42-authenticated as the pass's
  author before the relay accepts the deletion. A relay that hides pass
  events from unauthenticated readers (as above) MUST reject an
  unauthenticated revocation explicitly — `auth-required: ...`, or
  `restricted: ...` when a different key is already authenticated — rather
  than accept it (`OK: true`) and silently do nothing: since the deletion's
  own existence-lookup goes through that same read restriction, an
  unauthenticated connection would otherwise appear to have revoked the
  pass while it stays fully valid.
- Expiry only stops new joins.

## Pass check

`GET /.well-known/nip29/livekit/<group-id>/pass/<code-hash>` (no auth, CORS open):

```json
{
  "valid": true,
  "reason": "ok",
  "expiration": 1790000000,
  "scope": "call",
  "name": "Weekly",
  "picture": "https://example.com/weekly.png",
  "live_count": 3
}
```

`valid`, `reason` and `live_count` are always present. `not_before`,
`expiration`, `scope`, `name` and `picture` are omitted when empty (no
`not-before` tag, no `scope` tag, a group without name or picture) and
whenever the reason is `unknown`.

`reason` is one of `ok`, `not_yet`, `expired`, `call_ended`, `unknown`. A
revoked pass, a pass whose author is no longer a member, and a pass the
relay has already pruned after it expired all read as `unknown`. Group
details are returned only for a matching hash. A relay supports call passes
if and only if this endpoint answers JSON for the group (any hash).

A relay that also exposes a group under a community relay URL (e.g.
`wss://host/c/<rootId>`) serves the same pass-check endpoint under that
path too: `GET /c/<rootId>/.well-known/nip29/livekit/<group-id>/pass/<code-hash>`,
for groups that belong to that community only.

## Meeting passes (edufeed extension)

A guest link for a scheduled meeting (a NIP-52 kind 31923 event with exactly
one `["h", <group-id>]`, see `docs/guides/publishing-to-nip29-groups.md` §
"Scheduled meetings") is an ordinary call pass with no `scope` tag — it is
not tied to a running call — and a window built from the meeting's own
start/end instead of an admin-chosen one:

- `not-before` = meeting `start` − 15 minutes (900 s).
- `expiration` = meeting `end` + 30 minutes (1800 s).
- `["a", "31923:<pubkey>:<d>", <relay>]` links the pass to the meeting event
  (the coordinate `kind:pubkey:d`); a pass carries at most one such tag, and
  it is how a card rebuilds or revokes the right pass.
- `title`, when set, is the meeting's title.

A meeting more than ~60 days ahead (`expiration` would fall beyond the
relay's maximum pass lifetime) cannot get a guest link; the author is told
so and the meeting is created without a pass.

A rescheduled meeting keeps its guest link: the relay derives a pass's
state from the `not-before`/`expiration` frozen into the pass event (never
from the meeting the `a` tag names), so moving the meeting leaves the old
pass windowed around the old time. The organiser's client therefore
publishes a new pass with the **same code** (hence the same `code-hash`
and the same URL) and the window of the new time, then revokes the old
pass with a NIP-09 deletion — in that order, so the link never reads
`unknown` in between. A relay serves the newest pass for a hash. Only when
the old code cannot be read (its self-encrypted content is unreadable) is
a fresh code minted, and the organiser is told the link changed.

The guest landing page (`/call/<group pointer>#<code>`) derives the
meeting's displayed start/end from the pass check's own `not_before`/
`expiration` — `start = not_before + 900`, `end = expiration − 1800` — never
from a separate read of the 31923 event, since a guest cannot read the
group's events at all. Deleting the meeting revokes its pass(es) first, so
the guest page immediately reads `unknown` for anyone still holding the
link.

## Host and co-host (edufeed extension)

Participant tokens stay `RoomJoin` only; nobody in the call holds
`roomAdmin`. The relay keeps the room's **host** and **co-hosts** itself,
tells every client who they are through LiveKit participant metadata, and
offers a moderation endpoint that drives LiveKit with the relay's own admin
token.

### Who hosts

- **The scheduler.** While a channel meeting's window is open (a kind
  31923 with exactly one `["h", <group-id>]`, from `start` − 15 minutes
  until its `end`, an hour after `start` when there is none), the
  meeting's author is the host whenever they take a seat — also taking
  over from whoever opened the room before them, who keeps a co-host seat.
  The meeting's `p` tags whose role slot reads `co-host` (also `cohost`,
  `moderator` or `organizer`) make those participants co-hosts.
- **The opener.** Without a current meeting (or before its author shows
  up), the first member to obtain a token while nobody hosts is the host.
- **Promotion in the call.** The host may make any member seat a co-host
  (and revoke it) through the endpoint below; those roles last until the
  seat leaves. The `p`-tag roles are re-applied on every token.
- **Hand-over.** When the host leaves (and a freshly minted token's holder
  has had 60 s to show up in the participant list), the oldest co-host
  still present becomes host, else the member seat present longest, else
  nobody. Co-hosts who left lose the seat; the room emptying clears
  everything.
- **Never guests or listeners.** A call-pass seat keeps its
  `{"guest":true,"pass":…}` metadata and can be neither host nor co-host;
  a listen-only seat (non-member of a public group) cannot either.
- Roles live in the relay's memory for the running room only.

### Metadata

Member tokens carry `{"host":true}` or `{"cohost":true}`; a plain seat has
no metadata. When roles change while people are connected, the relay sets
the affected seats' metadata through `RoomService.UpdateParticipant`
(`{}` for a revoked role — LiveKit ignores an empty string), which clients
see as `ParticipantMetadataChanged`. Clients SHOULD render host and co-host
badges from this metadata exactly as they render the guest badge.

### Moderation endpoint

`POST /.well-known/nip29/livekit/<group-id>/moderate` (and, for groups of a
community, `POST /c/<rootId>/.well-known/nip29/livekit/<group-id>/moderate`),
CORS open. Authentication is NIP-98 like the token endpoint, but the
kind 27235 event MUST also carry `["method", "POST"]` and
`["payload", <sha256 hex of the body>]`, and its `created_at` must be within
60 s. Body:

```json
{ "action": "mute", "identity": "<LiveKit participant identity>" }
```

| action          | effect                                                                   | who                        |
| --------------- | ------------------------------------------------------------------------ | -------------------------- |
| `mute`          | `MutePublishedTrack` on the seat's unmuted microphone track(s)           | host, co-host, (moderator) |
| `stop-video`    | `MutePublishedTrack` on the camera track(s)                              | host, co-host, (moderator) |
| `stop-screen`   | `MutePublishedTrack` on the screen share (+ screen share audio) track(s) | host, co-host, (moderator) |
| `remove`        | `RemoveParticipant`; a guest's pass stays valid                          | host, co-host, (moderator) |
| `make-cohost`   | the seat's pubkey becomes a co-host; metadata is pushed                  | host, (moderator)          |
| `revoke-cohost` | the co-host role is taken away; metadata is pushed                       | host, (moderator)          |

A co-host cannot act on the host; nobody can act on their own seat; a
guest or listener cannot be made co-host. A NIP-29 group moderator or
admin is accepted as a fallback for every action, host or not. Muting does
not restrict publish sources: a muted participant may unmute themselves,
and a client whose screen share was muted SHOULD stop the share.

Answers: `200 {"ok":true}`; `400` for a bad body or unknown action; `401`
with the NIP-98 failure; `403` with a short reason (`only the host or a
co-host may do this`, `only the host may change roles`, `a co-host cannot
moderate the host`, `a guest cannot be co-host`, `cannot moderate
yourself`, …); `404` when the identity is not in the room; `502` when
LiveKit does not answer.

## In-call chat (edufeed extension, optional)

Guests do not read the group's events, so a call carries its own chat as
LiveKit data messages: reliable, topic `edufeed.call.chat`, payload
`{"t":"chat","text":"<≤2000 chars>","n":"<nonce ≤32 chars>","ts":<ms>}`,
`ts` (the sender's send time, unix milliseconds) optional. Receivers dedupe
on `(sender identity, n)`, drop anything else, and order the chat by `ts`
where present (a message without one counts as sent on receipt; a `ts` in
the future is clamped to now). Nothing is stored; the chat ends with the
call. Clients that ignore the topic are unaffected.

Late joiners: when a participant joins, every participant already present
sends the newcomer (`destinationIdentities`) its OWN recent messages, oldest
first, at most the last 50, as ordinary chat payloads with `ts` set to the
original send time. A client MUST NOT relay anyone else's messages — the
sender identity a receiver sees is the one LiveKit verified, so only the
author can vouch for a message. Messages of people who already left are
therefore not recoverable.
