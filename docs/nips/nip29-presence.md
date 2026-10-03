# NIP-29 extension: online presence

`draft` `optional` — proposed for edufeed-app and the edufeed pyramid fork; not implemented yet.

Members of NIP-29 groups can show that they are online. A client that has
the app open publishes a short-lived **presence heartbeat**; other clients
show the group members whose heartbeat is fresh. The wire format is the one
Buzz relays and Armada already use, so presence crosses clients.

Presence is **opt-in**. A client MUST NOT send heartbeats for a user who has
not switched them on.

## Heartbeat (kind 20001)

```jsonc
{
  "kind": 20001, // ephemeral
  "content": "online", // "online" | "away" | "offline"
  "tags": [["status", "online"]]
}
```

- No `h` tag: presence belongs to the user on that relay, not to one group.
  A reader decides which group's members to show (see "Reading").
- `content` and `status` carry the same value. Readers MUST take `content`
  (Armada does); `status` is for relays and tools that only look at tags.
- `offline` withdraws presence immediately (sent when the user switches
  presence off). Clients MAY skip it on page unload: the relay window below
  ends a missed `offline` within 90s anyway.

### Sending

- Every **30 seconds** while the app is visible (`document.visibilityState
  === 'visible'`), plus once immediately when it becomes visible again. No
  heartbeats while hidden: on phones, "online" means "has the app open".
- To the group relay's **host endpoint** (`wss://groups.edufeed.org`), never
  to a community endpoint (`/c/<root>`) — see relay requirements.
- 30s / 90s are Buzz's values. A slower client would flicker in Armada,
  which drops presence after 90s.

### Signing heartbeats

A heartbeat is signed like any other event — one code path for every
signer. It differs from user-initiated signing in four ways:

1. **Quiet.** A heartbeat never shows the slow-signing hint, never counts
   towards the connection status' "waiting for your signing app", and has
   its own short timeout (5s) instead of the 90s bunker bound.
2. **Pauses itself when the signer prompts.** A heartbeat signature that
   takes longer than 5s (or fails) means the signer asks the user every
   time. The client then stops heartbeats for the session and shows one
   hint: *"Your signing app asks for every online signal. Allow it
   automatically there, or turn off 'Show me as online'."* Without this, a
   waiting heartbeat prompt can also block the user's real request behind
   it in the signing app.
3. **Requests the permission up front.** NIP-46 logins request
   `sign_event:20001` in their connect permissions (`perms` in the
   `nostrconnect://` URI, the permissions argument of `connect` for
   `bunker://`), so Amber and nsec.app grant it once at login. Existing
   sessions approve it in their signer.
4. **Not for rate-limited remote signers.** Pomegranate (Google login,
   promenade FROST bunker) allows a client a burst of 50 successful
   signatures and refills 3 every 3 minutes — about one per minute
   sustained (`promenade/coordinator/ratelimit.go`). Heartbeats every 30s
   exhaust that within ~50 minutes, after which *every* signature of that
   user is refused ("rate-limited: you're making too many bunker calls"),
   posts and chat included. The presence switch is therefore unavailable
   for Pomegranate accounts, with a sentence saying why. (Relay-derived
   presence, see "Later", would cover them without signatures.)

## Reading

- Subscribe to `{"kinds": [20001], "since": <now - 90>}` on the group's
  host relay. The `since` returns the heartbeats the relay still holds
  (relay requirements below), the open subscription delivers new ones.
- Per pubkey keep the **latest** heartbeat. A pubkey is online while its
  latest heartbeat is `online` (or `away`) and at most **90s** old;
  `offline` removes it at once. Re-evaluate every ~30s so silent users
  drop out.
- Show presence only for **members of the group on screen** (kind 39002
  roster). Heartbeats from others on the same relay are ignored.
- Never show presence for a user who has not opted in — implicitly true,
  since such users send no heartbeats.

### Where it shows (edufeed-app)

- Channel member list: a green dot per online member.
- Channel header: "3 online" with up to four avatars (as Armada/Wisp do).
- Later, if wanted: community rail and DM list.

## Relay requirements

Ephemeral events are normally only forwarded to the subscriptions open at
that moment. For presence the relay additionally:

1. **Holds the latest heartbeat per pubkey for 90 seconds** and answers a
   `kinds:[20001]` REQ with the still-fresh ones (Buzz's "90s TTL"), so a
   freshly opened client sees who is online without waiting a full beat.
2. **Accepts heartbeats only from relay members** (anyone in any group),
   rejecting others — pyramid's `AllowEphemeralFromAnyone` default would
   otherwise let strangers fill the table.
3. **Serves `kinds:[20001]` only to authenticated relay members** (NIP-42).
   Presence is relay-wide, so it must not be readable by anonymous
   connections.
4. **Delivers heartbeats on every endpoint of the host**: a heartbeat sent
   to the host endpoint reaches subscribers of `/c/<root>` endpoints and
   vice versa. (Pyramid's virtual endpoints forward `OnEphemeralEvent` to
   the host relay; whether host-endpoint broadcasts reach virtual-endpoint
   subscribers is unverified and needs a probe.)

Kind 20001 is already in pyramid's per-group self-kinds (agent bridge,
`groups/self_kinds.go`) but not in `SupportedKindsDefault`; the deploy MUST
add it to the relay's allowed kinds in `/settings` (documented step).

## Privacy

- Opt-in, default off; one switch in `/settings` ("Show me as online in my
  communities"). Switching it off sends `offline` once.
- Heartbeats are ephemeral and kept 90s at most: there is no stored
  activity history on the relay. A reader who stays connected can still
  record when someone was online — the switch's description says so.
- Visible to authenticated members of the same relay, filtered to shared
  groups by clients. Relay operators see heartbeats like any traffic.

## Later (not part of the first version)

- **Relay-derived presence** for users who cannot heartbeat (Pomegranate,
  prompting bunkers): the relay knows who is NIP-42-authenticated and could
  publish a relay-signed per-group "online now" list, like kind 39004 does
  for call participants. Needs its own opt-in signal to the relay.
- **`away`** on a hidden tab instead of silence, if a "was here a minute
  ago" state turns out to be useful.

## Prior art

- Buzz relays / Armada `src/buzz/useBuzzPresence.ts`: kind 20001,
  content `online`/`away`/`offline`, 30s heartbeat while visible, 90s relay
  TTL, read with `since: now - 90`. Armada does this on Buzz relays only.
- Armada Concord voice: encrypted heartbeats (kind 23313 in 21059 wraps)
  for call participants only.
- NIP-53 kind 10312 "Room Presence": a replaceable heartbeat for one
  audio/video room at a time (Nests) — call presence, not "online".
- Wisp (barrydeen/wisp): no heartbeat; a followed author counts as online
  for 10 minutes after posting, reacting or commenting. Misses everyone
  who only reads.
- Ditto: no user presence (`useIsOnline` is the device's own network).
