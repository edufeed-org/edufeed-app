# NIP-XX — Communikey Community Types & Group Membership

`draft` `optional`

**Status:** implemented end-to-end by edufeed-app across five implementation
plans (plans 1–5, 2026-08-12/2026-08-13, branch `feat/community-group-pointer`),
covered by unit and component test suites plus a moderated-lifecycle browser
E2E run against an in-process NIP-29 mock relay. Ready for external review
and publication. This document was edited alongside the implementation and
now describes the shipped data model; drift found during the final
read-through is called out inline below where it applies.

The `publisher` role and the `kind:30223` content-section override were added
2026-08-21, from the same branch: together they let a community's root-group
admins run its public surface — which content types it offers, and who may
publish into each — without holding the community key.

Note on the E2E fixture: the in-process mock relay used for the
moderated-lifecycle test retains a stale admin-only kind `39001` entry on
`remove-user` (kind `9001`) rather than clearing the departed member from
the admin list. That retention behavior is the mock's own policy, not part
of this spec — conforming relays may retain or clear the entry at their
discretion, and clients MUST NOT assume either behavior when computing the
current roster/roles.

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

The root group MAY be `closed`; joining then happens via invite or application
approval (put-user).

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

#### The `publisher` role

`publisher` is the conventional role name for "may publish community
content, nothing more". Clients SHOULD offer it as a first-class choice
wherever they offer the `role` tier, and relays SHOULD advertise it in their
`kind:39003` as a role carrying no privilege.

Two consequences of NIP-29's data model are worth stating plainly, because
they surprise implementers:

1. **A publisher appears in `kind:39001`, the "admins" list.** NIP-29 has no
   other place to record a role — 39002 carries bare pubkeys. Clients MUST
   NOT infer moderation authority from 39001 membership alone; they should
   read the role names and present a publisher as a publisher.
2. **Relays MUST NOT grant moderation power on the strength of holding *a*
   role.** A relay that authorises `kind:9000`-`9020` for "any member with
   any role" hands every publisher the moderator's powers. Authorisation
   belongs to specific role names.

A `kind:9000` (`put-user`) replaces the target's entire role set, so clients
granting or revoking one role MUST rebuild the set from the roles that member
already holds.

### `application` (top-level, moderated only, optional)

```json
["application", "30168:<pubkey>:<d-tag>", "<wss://relay-hint>"]
```

Points at a form template (kind `30168`). When present, clients present the form
as the join flow; the encrypted response (kind `1069`) is addressed (p-tags) to
the **reviewers**: admins in `39001` whose role carries the `put-user`
capability, falling back to all admins when roles carry no capability info.
Capability-based reviewer selection is a future refinement — NIP-29 roles as
implemented today carry no machine-readable capability metadata, so
edufeed-app's current implementation resolves reviewers as **all** `39001`
admins, unconditionally. Approval is executed as a NIP-29 `put-user`
(kind `9000`), optionally with a role. Without an `application` tag, joining
is a bare NIP-29 join request (kind `9021`) or an invite code.

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

## Kind 30223 — content-section override (moderated only)

A community's content sections live on its `kind:10222`, which is addressable
by the community pubkey and therefore signable only by whoever holds the
community key. The people who run a moderated community are its root-group
admins, who do not hold that key — so without this every change to the
community's public surface has to go through the key-holder.

A `kind:30223` carries a section block on its author's own signature:

```json
{
  "kind": 30223,
  "tags": [
    ["d", "<community-pubkey>"],
    ["h", "<community-pubkey>"],
    ["content", "Materialien"],
    ["k", "30142"],
    ["access", "role", "publisher"]
  ]
}
```

The tag grammar inside the section block is exactly the 10222's, so one
parser serves both.

**Validity.** An override counts only if its `d` tag equals the community
pubkey AND its author is, *at read time*, either the community pubkey itself
or listed in the root group's current `kind:39001`. Judging against the
current roster rather than the roster at signing time makes the rule
retroactive in the same way `access` already is: demoting an admin revokes
their override with nothing to delete. Communities with no `membership`
pointer have no roster to judge against, so open and closed communities MUST
ignore `kind:30223` entirely.

**Precedence.** Among valid overrides the newest `created_at` wins, ties
broken by the lower event id so every client picks the same one. That winner
replaces the 10222's section block **as a whole** — never merged
section-by-section — but only while it is newer than the `kind:10222` itself.
An owner editing their community therefore reasserts control by the ordinary
act of saving. Clients SHOULD seed the owner's editing UI from the *effective*
sections so that save absorbs the admins' configuration rather than silently
reverting it.

**What an override may not carry.** Only `content`, `k` and `access` tags are
honoured. Per-section `["r", <url>, "content"]` relays, profile-list `a` tags,
badge requirements and form references MUST be ignored on a `kind:30223`, and
clients MUST NOT write them there: where a community's content is stored, and
its legacy gating, remain the key-holder's. The `["strict","content"]` marker
likewise stays a property of the 10222.

Because outsiders need the section block to render a community's tabs at all,
a `kind:30223` is an ordinary public event and MUST NOT be published only to
an auth-gated group relay.

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
  channel tags (the underlying groups persist on their relay). Any
  `kind:30223` overrides stop applying on their own — without a `membership`
  pointer there is no roster to validate their authors against — so they need
  no cleanup.
- **closed** is fixed at creation. No transitions to or from closed.

### Legacy

Section-level profile-list references (`30000:...`) and badge requirements
(`30009:...`) are read-only legacy; clients honoring this spec MUST NOT write
them — with one sanctioned exception: the **publisher window** below, which
writes exactly one profile list (`d` = `publishers`) on communities carrying a
`concord` pointer. Kind `30222` targeted publications remain read-only legacy.

Clients SHOULD NOT offer creating new profile-list gating; they MAY preserve
existing profile-list tags when editing a legacy community. Flipping a
community to moderated MUST strip them. As a deliberate transitional
exception, a client editing an existing legacy-gated **open** community MAY
continue to surface that community's form-gating UI rather than tearing it
out mid-edit.

## Publisher window (Schaufenster) for concord communities

A community with a `concord` pointer keeps its membership end-to-end
encrypted — which makes publicly *verifiable* member-gating of its public
sections structurally impossible (a reader cannot check authorship against a
roster nobody may see). The publisher window resolves this with a **consented
public subset** of the private membership:

- **Publisher role (private).** Inside the Concord area, the owner creates a
  CORD-04 role named `Publisher` and grants it to members. Grants are E2E;
  the world learns nothing.
- **Publisher consent (private).** Listing a member publicly REQUIRES that
  member's explicit acceptance. A member accepts or revokes by publishing a
  **kind `3320`** rumor to the area's guestbook plane with tags
  `["t", "publisher-window"]` and `["status", "accepted"]` (or `"revoked"`).
  Latest rumor per member wins. Consent is E2E like every guestbook rumor.
- **Public roster.** Once BOTH the grant and the acceptance exist, the
  community key publishes/updates a NIP-51 follow set
  `kind 30000, d = "publishers"` listing the consenting publishers' `p` tags.
  Revoking the role OR the consent MUST remove the pubkey on the next update.
  Because only the community key signs this list, updates happen when a
  key-holding client is online — acceptance-to-listing latency is expected.
- **Section gating.** The community's public sections reference the list with
  the standard profile-list form `["a", "30000:<community-pubkey>:publishers",
  "<relay-url>"]`. Readers verify the public window exactly as for any
  profile-list-gated section: only posts authored by listed publishers (or
  the community key itself) belong to the section.

Privacy properties: the public list discloses ONLY consenting publishers —
never the membership size or any other member. A publisher self-discloses by
authoring public posts regardless; the list adds no information beyond that.
`access` tiers (`members`/`role`) remain moderated-only — they require the
public NIP-29 roster and MUST NOT appear on concord-pointed communities.

In-area sharing is unaffected: any member writes inside the area's channels
(E2E); the publisher window governs only the community's public sections.

**Window sections and type derivation.** A GESCHLOSSEN community opens its
window by declaring content sections that carry the publishers-list gate —
the owner picks which content types the window exposes, and each becomes a
regular `content` section (`["content", <Name>]` + `k` tags) whose only gate
is the publishers list. Type derivation treats these sections as part of the
closed shape: a concord community counts as OPEN only while it has at least
one content section **not** gated by its own publishers list. A community
whose public surface is exclusively window sections therefore stays
GESCHLOSSEN (clients may display it as "Privat mit Schaufenster"), and
clients SHOULD surface the window sections to the public — hiding them
defeats the window. Updating the publishers list MUST NOT itself add or
remove section gates; the window's section set is the owner's separate,
explicit choice.

## Future extensions (recorded, not specified)

- **Discoverable closed communities:** Armada-style invite links (expiry, label)
  with a "share to discovery" option that publishes the link secret, making a
  closed community publicly joinable while staying E2E.
