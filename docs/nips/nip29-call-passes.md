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
    ["expiration", "<unix seconds>"],       // NIP-40, required
    ["not-before", "<unix seconds>"],       // optional
    ["scope", "call"],                      // optional
    ["a", "31923:<pubkey>:<d>", "<relay>"]  // optional: the NIP-52 meeting it belongs to
  ]
}
```

- The code SHOULD carry at least 128 bits of randomness. Only its hash is
  public; the self-encrypted content lets the author's other devices rebuild
  the link.
- `scope=call`: the pass is valid only while the group's call is running and
  the relay deletes it when the call ends. A relay MUST additionally cap a
  `scope=call` pass's lifetime at 12 hours (regardless of its `expiration`
  tag), and SHOULD delete call-scoped passes when the call's participant
  list becomes empty, besides on room end.

Relays MUST accept a pass only from a member of the group (kind 39002 or
39001) of a group with live audio/video, with an `expiration` in the future
and within the relay's maximum lifetime, and SHOULD cap the number of active
passes per group. Relays SHOULD show pass events only to their author and to
the group's moderators.

## Using a pass

The NIP-98 token request to `/.well-known/nip29/livekit/<group-id>` carries
the code in the signed event:

```json
["code", "<code>"]
```

- A requester who is a member is treated as before; the code is ignored.
- A non-member with a valid code (`not-before <= now < expiration`, and for
  `scope=call` a running call) receives a full token, also for private
  groups. The call is all that is granted: reading the group's events
  remains governed by membership.
- A non-member with an unusable code receives `403` with body
  `call pass <reason>`.
- Guest tokens carry participant metadata `{"guest":true,"pass":"<pass event id>"}`.

## Revocation and expiry

- The author revokes a pass with a NIP-09 deletion, a moderator with a
  NIP-29 kind 9005. The relay then removes every call participant whose
  metadata names the pass.
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
{"valid": true, "reason": "ok", "not_before": 0, "expiration": 1790000000,
 "scope": "call", "name": "Weekly", "picture": "", "live_count": 3}
```

`reason` is one of `ok`, `not_yet`, `expired`, `call_ended`, `unknown`.
Group details are returned only for a matching hash. A relay supports call
passes if and only if this endpoint answers JSON for the group (any hash).

A relay that also exposes a group under a community relay URL (e.g.
`wss://host/c/<rootId>`) serves the same pass-check endpoint under that
path too: `GET /c/<rootId>/.well-known/nip29/livekit/<group-id>/pass/<code-hash>`,
for groups that belong to that community only.
