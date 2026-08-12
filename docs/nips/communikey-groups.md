# NIP-XX — Communikey Community Types & Group Membership

`draft` `optional`

**Status: working draft.** This document is edited alongside the implementation in
edufeed-app and becomes the published spec once the implementation stabilizes.
It extends the Communikey community specification (kind `10222`).

## Abstract

A Communikey community (kind `10222`, identified by its pubkey) can operate in one
of three types:

| Type | German UI label | Machinery |
| --- | --- | --- |
| open | Offen | plain 10222, no group |
| moderated | Moderiert | 10222 + NIP-29 root group (public roster & roles) |
| closed | Geschlossen | 10222 shell + E2E group engine (Concord/CORD today) |

The type is **derived, never declared**:

- `concord` pointer tag present → **closed**
- `membership` tag present → **moderated**
- neither → **open**

A `membership` tag and a `concord` tag MUST NOT coexist on the same 10222 (XOR).
Clients MUST treat an event violating this as invalid for type derivation and fall
back to **open**.

## Tags on kind 10222

### `membership` (top-level, moderated only)

```json
["membership", "<nip29-group-id>", "<wss://group-relay>"]
```

Points at the community's **root group** on a NIP-29 relay. The root group's
member list (kind `39002`) and admin list with roles (kind `39001`) are THE
community membership. Joining the community means joining this group; all
publish-access rules resolve against this single, publicly verifiable roster.

Channels are additional NIP-29 groups (see `group` below). Their rosters are
mirrored from the root group by admin fan-out; that mirroring is an
implementation detail, not semantics.

### `access` (section-level, moderated only)

Placed inside a `content` section (after the `content` tag, like `k` tags):

```json
["access", "members"]
["access", "role", "<role-name>"]
```

- absent → any Nostr user may publish this content type to the community
- `members` → only pubkeys on the root group's current roster (39002)
- `role` → only roster members holding `<role-name>` per the root group's 39001

`<role-name>` references a role defined in the root group.

### `application` (top-level, moderated only, optional)

```json
["application", "30168:<pubkey>:<d-tag>", "<wss://relay-hint>"]
```

Points at a form template (kind `30168`). When present, clients present the form
as the join flow; the encrypted response (kind `1069`) is addressed (p-tags) to
the **reviewers**: admins in `39001` whose role carries the `put-user`
capability, falling back to all admins when roles carry no capability info.
Approval is executed as a NIP-29 `put-user` (kind `9000`), optionally with a
role. Without an `application` tag, joining is a bare NIP-29 join request
(kind `9021`) or an invite code.

### `group` (top-level, channels; moderated only)

```json
["group", "<nip29-group-id>", "<wss://group-relay>", "<name>?", "<access>?"]
```

One tag per channel. Slot 5 `access`: `members` (roster mirrored from root) or
`invited` (explicit subset); absent = world-open. Channel world-*readability* is
determined by ONE rule everywhere: the channel's `39000` lacking the `private`
flag, capped by the relay's NIP-11 `auth_required`.

### `concord` (top-level, closed only)

```json
["concord", "<area-id>", "<wss://relay>"]
```

Points at the community's E2E group engine (Concord/CORD). A future engine gets
its **own tag name**; the pointer tag identifies the engine ("closed" is a
product concept with a swappable engine). A closed community's 10222 carries no
content sections — the public 10222 + kind-0 exist only as a discoverable shell
("invitation required"). Content sections on a closed community's 10222 MUST be
ignored.

## Semantics

### Gating is write-gating

`access` rules restrict who counts as an author of community content. They never
restrict reading: a moderated community's content pages are world-readable.

Enforcement is layered:

1. **Display filtering (normative for clients):** when rendering a gated content
   section, clients MUST only render events whose author satisfies the section's
   `access` rule against the **current** roster/roles. Removal from the roster
   retroactively removes that author's content from the community view (the
   events remain on relays and in global/discovery contexts).
2. **Relay enforcement (optional):** a community relay MAY enforce the same rule
   at write time by resolving the `membership` pointer and checking `39002`/
   `39001` on the group relay. Client behavior is identical either way.
3. Composer-side checks are UX guidance only.

An event h-tagged to multiple communities is evaluated per community; it may
render in one and be filtered in another.

### Follower ≠ member

Following a community (client-side follow lists) is open to anyone for every
type and is unrelated to membership. Membership exists only for moderated
(NIP-29 roster) and closed (encrypted engine roster) communities.

### Type transitions

- **open → moderated:** create root group (owner as admin), add `membership`
  tag. All existing content sections start with no `access` tag (= everyone);
  tightening is a separate deliberate act. Followers are not auto-added to the
  roster.
- **moderated → open:** remove `membership`, all `access` tags, and all `group`
  channel tags (the underlying groups persist on their relay).
- **closed** is fixed at creation. No transitions to or from closed.

### Legacy

Section-level profile-list references (`30000:...`) and badge requirements
(`30009:...`) are read-only legacy; clients honoring this spec MUST NOT write
them. Kind `30222` targeted publications remain read-only legacy.

## Future extensions (recorded, not specified)

- **Discoverable closed communities:** Armada-style invite links (expiry, label)
  with a "share to discovery" option that publishes the link secret, making a
  closed community publicly joinable while staying E2E.
