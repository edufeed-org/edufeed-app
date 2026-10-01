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
