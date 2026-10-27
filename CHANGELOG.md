# Changelog

All notable changes to Edufeed are recorded here, newest first. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
the `vX.Y.Z` git tags on `main`. Each release section is assembled from the
merge commits of the nostr PRs that landed since the previous tag.

## [Unreleased]

## [0.11.0] - 2026-10-27

Canonical concept identifiers (NIP-VOCAB revision of 2026-10-27): concepts
without an external URI are now identified by their canonical Nostr URI
`nostr:naddr1…` instead of the raw `nostr:<kind>:<pubkey>:<d>` coordinate,
which was not a NIP-21 URI. Five commits on `main`, no nostr PRs. Cut as
`v0.11.0-rc.1` on dev.edufeed.org before this tag.

### Changed

- Concept pickers (template forms and ext facets) emit the canonical
  `nostr:naddr1…` id for Nostr-published concepts and match stored values
  form-independently, so resources that still carry the legacy form show
  their concept as selected and are never "healed" into another concept.
  A matched legacy value is enriched once with its coordinate and relay.
- Published resources carry one companion
  `["a", "39738:<pubkey>:<d>", <vocab relay>, "<prefix>"]` tag per
  Nostr-published concept (`about`, `educationalLevel`, …, `ext:<form>:<field>`),
  per NIP-VOCAB "Referencing Vocabulary Concepts from Other Events".
- Relation ids (`isPartOf`/`hasPart`) are relay-less canonical naddr; the
  relay hint moves to the relation's `a` tag and is recovered from it on
  edit (NIP-AMB reverse step 9).
- Every publish path (template form, wizard) canonicalises concept ids
  before conversion, so the app never emits the legacy form.
- Ext-facet search filters send both the canonical and the legacy form of a
  concept id: relays match tag values exactly and existing resources store
  the legacy form.
- Dependencies: nostr-vocab-core 0.4.2 (`canonicalIdentifier`,
  `sameIdentifier`, `decodeNostrIdentifier`), amb-nostr-converter
  `0.0.0-e7e6c23` (canonical ids, companion tags, relay-less relation ids).

### Deploy notes

- None. No env vars changed; the two package pins come from the Forgejo
  npm registry via the lockfile.
- amb-indexer 0db1dad (facet canonicalisation) is already on all three
  indexers; existing documents keep their legacy facet value until a
  re-ingest, so one concept can show as two facet values for a while.

## [0.10.1] - 2026-10-27

Patch release: one fix for the membership admin page. Cut as
`v0.10.1-rc.1` on dev.edufeed.org before this tag.

### Fixed

- The membership applications page no longer floods edufeed.org with
  `/.well-known/nostr.json` lookups. The check whether an applicant's
  wished handle is already provisioned re-ran for every still-unknown
  handle each time a row decrypted or an approval changed — O(n²)
  requests that got the admin's IP rate-limited (429) with a dozen open
  applications. Each applicant is now looked up once per page load.

### Deploy notes

- None.

## [0.10.0] - 2026-10-24

Nine PRs: the feeds move to applesauce v7's window-based timeline loader
and gain live updates, /discover is split into hooks and per-tab
components with four fixes on top, inline previews resolve through the
EventStore instead of erroring, blog posts get author credits, licence,
TULLU provenance and drafts with a preview link, and deployments can block
authors and hide bulk calendar sources. `rc.2` adds three more PRs:
NIP-70 protected events with NIP-42 AUTH on the publish path, crawlable
content with a sitemap for search engines and AI assistants (GEO), and
repairs for the five test suites that failed on main; `rc.3` adds the
`SEARCH_INDEXING` switch that keeps staging out of search indexes; `rc.4`
fixes the author pick on /discover; `rc.5` keeps mirrors of partner
content out of search indexes and adds a countdown to the guest call
page; `rc.6` adds a shareable link to each channel meeting. Cut as
`v0.10.0-rc.1` to `rc.6` on dev.edufeed.org before this tag.

### Deploy notes

- New env `BLOCKED_PUBKEYS` (authors hidden everywhere; nothing of theirs
  enters the EventStore or the cache) and `CALENDAR_HIDDEN_PUBKEYS` (bulk
  calendar sources hidden from the global calendar, /discover events and
  the landing by default; readers can show them from the count line).
  Both take npub, hex or the naddr of a NIP-51 kind 30000 list. Only the
  listed authors are hidden — a NIP-24 `bot: true` profile alone hides
  nobody, so OER World Map stays visible while the Bildungsserver and
  EvBildung mirrors are listed (homelab `deploy_edufeed_app.yml`).
- Article drafts are kind 30024 on the longform relay
  (`LONGFORM_CONTENT_RELAY`): its write policy must accept kind 30024
  next to 30023.
- Prod and STIL `CALENDAR_RELAYS` drop `wss://dev.calendar-relay.edufeed.org`
  (the crawlers left it on 2026-10-07; only stale test-mirror events came
  from there).
- GEO (rc.2): new env `GEO_SERVER_CONTENT_SHARE` (share of indexable pages
  that get the server-rendered body; prod 0.5 for the A/B experiment),
  `GEO_ASSIGNMENT_SALT`, `GEO_INDEX_AUTHORS` (accounts whose content is
  indexable besides content published through this deployment and curated
  authors), `SITEMAP_AMB_RELAYS` and `GEO_STATS_DIR` with a volume for the
  daily crawler/referral counters. Prod values are in homelab
  `deploy_edufeed_app.yml` (`edufeed_app_geo_stats: true`). `/sitemap.xml`
  and a dynamic `/robots.txt` are new routes.
- `SEARCH_INDEXING` (rc.3, default true): `false` on a staging deployment
  that mirrors prod content (dev.edufeed.org) gives `robots.txt`
  `Disallow: /` without a sitemap, a 404 sitemap and `noindex` on every
  page, so dev never duplicates edufeed.org in search indexes. Prod, STIL
  and RPI leave it unset. Homelab main sets it for the dev block.
- GEO (rc.5): new env `GEO_ORIGINAL_URLS` (per-account URL templates,
  `<npub>=https://oer.community/{d}/`, for partners whose events don't
  carry a `source` tag yet). Homelab main sets it for prod and dev
  (FOERBICO → oer.community, Jörg Lohrer → joerg-lohrer.de).
- NIP-70 (rc.2): relay.edufeed.org needs NIP-42 AUTH on
  (`strfry_auth_enabled: true`, homelab `deploy_strfry.yml`) — enable it
  only AFTER this app version is deployed, since older builds never
  answered AUTH. Until then the "Protected" toggle reports no accepting
  relay. dm.edufeed.org and the Concord relay stay without AUTH.
- applesauce 6.2 → 7.0 across all packages.

### Added

- Feeds (/discover articles, learning, boards; dashboard relay feed) keep
  a live subscription open: events published while the page is open show
  up at once, and a tab that becomes visible again catches up on what it
  missed.
- Blog posts: a collapsible "Urheberschaft & Lizenz" section credits other
  people as creator or contributor (Nostr contacts or plain names), names
  the licence, and records origin URL and change note as the TULLU rule
  asks. A foreign creator takes the byline on the article page and on
  feed cards ("Veröffentlicht von" names the publisher); the provenance
  block offers a copyable TULLU citation.
- Blog drafts: "Als Entwurf speichern" stores the post as NIP-23 kind 30024. The draft has an unlisted preview page with an "Entwurf" banner,
  appears in no feed, is listed in the owner's "Deine Inhalte", and
  publishes from the banner with credits, licence and provenance intact.
- Deployment lists `BLOCKED_PUBKEYS` and `CALENDAR_HIDDEN_PUBKEYS` (see
  deploy notes); the hidden-sources control sits in the count line
  ("Oktober 2026 · 22 Events · 918 importierte ausgeblendet · anzeigen",
  same on /discover's results line).
- Protected events (NIP-70): a "Protected" toggle (default off) in the
  note composer and the article editor publishes with the `["-"]` tag only
  to relays that advertise NIP-42 and NIP-70, answers the relay's AUTH
  challenge with the active account, names the accepting relays in a
  toast, and shows a lock on note cards, article cards and detail pages.
  Reposts never embed a protected event. Not offered for resources,
  calendar events and comments.
- Crawlable content (GEO): articles, wiki entries and learning resources
  published through this deployment or by curated/listed authors get a
  canonical link, JSON-LD and a server-rendered body that crawlers without
  JavaScript can read; everything else carries `noindex`. `/sitemap.xml`
  lists the indexable pages, `/robots.txt` points at it, and daily crawler
  and referral counters (sums only, no personal data) are written when
  `GEO_STATS_DIR` is set.
- GEO (rc.5): mirrors of partner content get `noindex` and stay out of the
  sitemap, following Google's advice for syndicated content — the
  partner's original keeps the search visibility. A mirror is an event
  with a `["source", <url>]` tag (the blog form's "Ursprung"), a learning
  resource whose d-tag is a URL, or a match of a `GEO_ORIGINAL_URLS`
  template whose page exists. Convention: wiki article "Original sources
  of mirrored content". Articles link their source even without a license.
- Calls (rc.5): the guest landing page shows a countdown button before the
  call window opens.
- Meetings (rc.6): "Link kopieren" on every meeting card. The link
  (`?meeting=<d-tag>`, built from the page the reader is on) opens the
  channel on that meeting: highlighted, with a login prompt when logged
  out, "only members can join" for non-members, "Beitreten ab <time>"
  before the join window, and the focus on "Beitreten" once it opens.

### Changed

- Feeds run on applesauce v7's window-based timeline loader
  (`createTimelineFeed`): per-relay coverage, exhaustion, retry and late
  relays/authors live in the SDK; the v6 block-paging port and its 33 test
  shims are gone. Every one-shot request goes through `fetchEvents` /
  `fetchOutbox` and completes, which also wakes code that waited on
  completion for the first time (inbox RSVP and poll-vote notifications,
  kanban and calendar-management loading states).
- /discover is split into a feeds hook, a learning-search hook, a
  community-scoped-items hook, pure pipeline helpers and per-tab
  components (the route drops from 1861 to 793 lines). The communities
  tab now really pages on scroll.
- Every event inserted into the shared EventStore gets its own prototype,
  so an event held in a deep `$state` can no longer trip Svelte's
  `state_descriptors_fixed` on applesauce's memoization.

### Fixed

- Inline references (an article quoted in an event, a calendar event in a
  post) no longer show "Article not found" or a 15–20 s skeleton: previews
  resolve store-first through the EventStore, a missing target renders
  the identifier badge and upgrades in place, the IndexedDB cache read is
  bounded to 1.5 s, and the loaders run 16 concurrent batches with a 5 s
  stage timeout.
- /discover: switching tabs no longer carries the search to the next tab;
  "Meine Communities" says whether the list is loading, empty or could not
  be loaded; lazy card rendering and the scroll sentinels observe the
  scrolling `<main>` (a 720 px viewport rendered no learning card until
  scrolled); the discover e2e specs match the card variants again.
- Calendar: the Tags and Personen filter panels open towards the left so
  the Personen panel no longer runs past the viewport on wide screens.
- Placeholder boards ("Untitled Board", "Shared 12345") are kept off the
  discover and dashboard feeds.
- /discover (rc.4): picking a person from the search suggestions no longer
  keeps the typed name as a content search next to the author chip (a
  person with content showed 0 results); the imported-events fragment in
  the results line appears on the events and "all" tabs only.
- GEO: a slow relay no longer makes a page answer `noindex` (provisional
  answer for 30 s instead); learning resources need a real description
  (40+ characters) to be indexable.
- Test suites: the five suites that failed on main after v0.10.0
  (CalendarEventPreview, EditProfileModal, SignupModal,
  ResourceFormWizard.edit-prefill, AMBResourceCardInteractive,
  concord-notifications) are repaired; test files only.

## [0.9.0] - 2026-10-22

Ten fixes and features from the issues of the last twelve days: licences
for external images, profile pictures and calendar event pages, a "Meine
Uploads" tab that deletes a file from Blossom together with its
attestation, keywords and subjects on licence attestations, resources a
person is involved in on their profile, a contributor role, the community
owner's seat protected from their own admins, and the iPhone search field
on /discover that lost its focus. Cut as `v0.9.0-rc.1` on dev.edufeed.org
before this tag.

### Deploy notes

- No new environment variables.
- New server endpoint `GET /api/image-hash?url=` (hashes a public image for
  the licence flow; same SSRF/redirect/size guards as `/api/image`).
- The relay half of the owner-seat protection is the pyramid PR
  `pr/creator-keeps-admin` (next `edufeed-v1.23`); until it is deployed the
  guard is client-side only.
- Wiki: edufeed/wikis PR #10 adds the "Indexing" section to
  `license-events-nope` (keywords `t` and subjects `about:*` on kind 1063).

### Added

- Licence for pasted external image URLs: the resource form hashes the
  image server-side and offers "Lizenz angeben"; an existing attestation
  for that hash shows as before. The licence stays optional for external
  URLs.
- Profile and community pages show the licence of the picture and banner
  ("Profilbild: CC BY 4.0 · …") when an attestation exists; no caution is
  shown for unattested avatars.
- "Meine Uploads" tab on your own profile: every file you attested, one row
  per hash, "Entfernen" deletes the blob from its Blossom servers (BUD-01)
  and withdraws the attestation (kind 5).
- Licence attestations (kind 1063) can carry keywords (`t`) and subjects
  (`about:*` from the KIM subject vocabularies) through a collapsed
  "Erschließung (optional)" section of the licence dialog; the licence
  info card shows them.
- Materialien on a profile also list the resources that name the person
  as creator or contributor (`p` tag with role) — flagged "Beteiligt".
- Resource form people input: Urheber:in / Mitwirkende:r role;
  contributors go out as `["p", …, "contributor"]` or `contributor:*` tags
  and are shown as "Mitwirkende:r" on the resource page.

### Fixed

- The community owner's seat can no longer be demoted or removed by the
  admins they appointed (client guard in all roster surfaces, plus a roles
  hint); the relay-side rule follows with the next pyramid release.
- /discover on iPhone: typing into the search field no longer scrolls
  `<main>` to the top and drops the keyboard — the layout's scroll restore
  skips navigations made while a text field has focus.
- `/calendar/event/<naddr>` shows the image licence pill like the card and
  the modal.
- EKKW form: "Rollenspiel" was listed twice in the Methode picker — a stale
  copy of a concept that had moved to `konfi-methode` on one relay; the
  vocabulary loader now re-requests each concept by address once per
  session so a moved concept leaves the list.
- Konfi form: the keywords field was missing from step 4b, so AI-prefilled
  keywords went out unedited.

## [0.8.0] - 2026-10-22

The mobile chrome redesign (labeled dock, Bereiche sheet, plain-words login
and landing), a curated landing showcase, key-backup safety in signup and
logout, community moderators removing other people's content, a generic
view for unknown event kinds, and a round of call and breakout fixes from
the 2026-10-13 user test. First release cut as a release candidate
(`v0.8.0-rc.1` on dev.edufeed.org) before this tag.

### Deploy notes

- `LANDING_SHOWCASE_LISTS` (kind 30000 list naddrs): set it, or the
  logged-out landing shows no live content.
- New communities take their default relays from the communikey relays
  (`COMMUNIKEY_RELAYS`) and their blossom server from
  `DEFAULT_BLOSSOM_SERVERS` — no more hardcoded edufeed production relay.
  Unset means the creation form asks for a relay.
- Optional: `APP_HANDLERS_ENABLED` / `APP_HANDLER_RELAYS` (NIP-89, default
  on); `PUBLIC_BLOSSOM_SERVERS`, `BLOSSOM_ELIGIBLE_PUBKEYS`,
  `BLOSSOM_ELIGIBLE_NIP05_DOMAINS` (Blossom upload gate, off when unset —
  only turn on with a blossom-server that enforces the same rules).
- Guest broadcasts in calls need the groups relay at pyramid
  `edufeed-v1.21` or later (deployed on groups.edufeed.org).
- CI: tags with a `-` (`vX.Y.Z-rc.N`) publish only their own image tag and
  never move `:latest`.

### Added

- Phones: a labeled five-item dock (Start, Entdecken, Erstellen,
  Posteingang, Communities), also inside communities; Termi opens from the
  header; the Posteingang has a Nachrichten tab. Inside a community a
  Bereiche chip opens every section as a bottom sheet, replacing the
  scrolling section bar; the community header gets a back arrow, the
  switcher and a settings gear for owners.
- Landing: plain-words hero with "Konto erstellen" and a showcase of new
  materials, upcoming events, new articles and a community wall — only
  content by, or into, the accounts and communities on the
  `LANDING_SHOWCASE_LISTS`; a visible Anmelden button on phones.
- Signup ends on a "Sichern" step; logging out a key that was never
  downloaded asks first ("Ohne Sicherung abmelden?"); backup files carry
  the account name and a short npub, so two backups no longer overwrite
  each other; "Schlüssel sichern" in the account menu.
- Community owners and moderators can remove other people's content from
  the community (NIP-32 label, kind 1985, `communikey.moderation`); the
  original event is untouched, removals are listed and restorable in the
  community settings.
- Event kinds without a dedicated view open in a generic detail page
  (author, title, content, reactions, comments) with NIP-89 "open in
  another app" links.
- Blossom upload gate: eligibility prediction, fallback to public servers
  on a 401/403, Termi hints to fix the server list.
- Calls: a second tab says "Du bist in einem anderen Tab im Anruf" before
  seating you twice; co-hosts see the breakout panel read-only and may
  broadcast to the rooms.
- Termi tells extension users once when their extension cannot encrypt
  (NIP-44), which DMs, private channels and guest links need.

### Changed

- The account dialog is titled Anmelden, opens as a bottom sheet on
  phones and explains each login method in one line.
- Breakout rooms: "Raum N" everywhere, the call timer survives room
  switches, the banner closes with "Ausblenden".
- Store first, network second: curated/WoT author lists are served from
  cache and refreshed in the background (no splash wait after five
  minutes away), `/discover` renders what is already in the store on
  back-navigation, the webxdc app picker skips known apps.

### Fixed

- Call-pass guests on private channels now hear the host's broadcasts.
- "Link erstellen" for guest links is disabled up front, with the reason,
  when the login cannot encrypt.
- Conversations read on an earlier visit no longer show as unread after a
  reload (read markers only move forward).
- The bookmark menu on a resource page opened behind the sidebar.
- New communities no longer land on the edufeed production relay from
  e2e runs, local checks or whitelabel deployments.
- The call pop-out window no longer turns black on Windows/Edge when its
  controls fade (needs confirmation on Windows).
- Ten vitest suites that had drifted behind the code pass again.

## [0.7.0] - 2026-10-13

Calls and breakout rooms hold up through what happens in every conference:
the host hangs up, drops or reloads, seats drop or reload, rooms close,
tabs run stale code. Designed against twelve conference scenarios and
verified live on a local relay + LiveKit stack with scripted browsers, plus
a user-level test drive. The host rules need the groups relay at pyramid
`edufeed-v1.20` or later (deployed on groups.edufeed.org).

### Added

- A toast "Eine neue Version von Edufeed ist verfügbar" with "Neu laden"
  once a deploy lands (SvelteKit version polling every five minutes),
  held back while a call is live; the version reported in error reports
  carries the commit.
- After a reload the channel page offers "Zurück in den Anruf" for ten
  minutes while someone is still in the call; a connection lost inside a
  breakout room offers "Zurück in den Raum" and "Zum Hauptraum".
- The breakout banner has "Im Hauptraum bleiben"; a chip "Breakout-Räume
  (N)" brings it back. Escape closes the rooms dialog.
- Whoever inherits the host seat runs the breakout session (panel, moves,
  end); a seat in the main room follows the channel's rooms on the relay
  itself, so a lost data message no longer hides a session.

### Changed

- Host role (relay): a host who drops keeps the seat for 120 seconds, a
  deliberate hang-up hands over after 15 seconds, a host visiting a
  breakout room stays host, a returning former host becomes co-host.
  Breakout rooms end with the call instead of surviving into the next one.
- The breakout panel and banner count who is live in a room, not the
  roster (the relay seats the session's creator on every roster); a seat
  that left is shown as "nicht im Raum".
- "Zurück zum Hauptraum" sticks: a seat back on its own is not treated as
  a late joiner and re-assigned; neither is a seat with a role.
- Guests: the host re-sends the session state to guest seats every
  15 seconds and guests check the rooms' tombstones every 20 seconds, so
  a guest no longer keeps last session's "Raum 1" beside the new one.

### Fixed

- Joining a call in Firefox as a guest crashed the page
  (`each_key_duplicate`): the device pickers keyed by `deviceId`, and
  Firefox lists several devices with an empty id before a permission is
  granted.
- A failed switch into a breakout room left the seat on the error screen
  outside every room.
- Rooms the relay had deleted stayed listed and "Beitreten" ended in a
  generic error: the relay now broadcasts a deleted room's tombstone and
  9008 on both endpoints and answers reads for it, the client re-checks
  the rooms before joining and after every return, a 404 says "Diesen
  Raum gibt es nicht mehr.", and the relay's "doesn't exist" refusal
  drops the room.
- A private channel's presence and rooms were withheld from a freshly
  reloaded tab until it had authenticated; the watches now reopen once
  the connection is authenticated, and after a relay outage with backoff.
- A seat that had opened a breakout room (that room's own host seat) took
  the whole session over on its way back to the main room.
- A host back from a reload was pulled into a room by the roster rule
  before taking the session over; a host entering a room auto-assigned
  everyone already in the main room.
- A breakout room closing wiped the reload note, so the way back was gone.

## [0.6.0] - 2026-10-12

The call stage as a "Bühne", the verified address explained, and breakout
rooms that work for late joiners. The breakout changes need the groups
relay at pyramid `edufeed-v1.19` or later (deployed on groups.edufeed.org).

### Added

- The in-call UI is one room in the page's colors with the chrome floating
  over it: a title pill with the way back, duration and role; status pills;
  a dock along the bottom with one red leave button; one drawer beside the
  tiles for participants or chat. Title row and dock step back after a few
  seconds without input. On a narrow stage the device menus move from the
  dock's chevrons into "Mehr". The participants drawer is as wide as the
  chat column, so switching between them does not move the tiles, and the
  dock keeps clear of the drawer.
- The verified address is explained: an info card on the "Verifiziert"
  chip, an "Adresse" step in the signup, and a NIP-05 address
  (`name@edufeed.org`) works in the people search and as `/p/<address>`.
  Wiki hash deep links land on their heading.
- Breakout rooms: a late joiner of the main room sees the running rooms
  and walks into one by themselves (the relay seats members of the channel
  on their own join request), and a host sitting in a room sees who
  arrived in the main room — a toast with the name, a "N im Hauptraum"
  pill with "Hierher holen", and the smallest room when "Nachzügler
  automatisch verteilen" is on. A roster that names a seat is its
  assignment, so the host seats people from any room through the relay.
- A new breakout setting, "Teilnehmende sehen die Räume und können selbst
  beitreten": unchecked, participants only learn that a session runs and
  the host assigns them.

### Changed

- Vocabulary publishing moved to the edufeed/vocabs repository.
- In the chat, the actions on one's own messages sit left of the
  timestamp, which stays flush with the bubble.

### Fixed

- Breakout: a member who came in through the invite link follows the
  rosters again, microphone, camera and the call chat survive the way back
  to the main room, and (with relay `edufeed-v1.17`) the host joining a
  room no longer ends the guests' session. "Zurück zum Hauptraum" gives the
  room seat up, so the host can bring the person somewhere else afterwards.
- Resource forms keep a stored concept value that is outside the picker's
  scheme when editing, and no longer mistake "Kunst: Malen"-style labels
  for canonical ids.
- The chat composer puts the caret on the text line and shows the
  placeholder again after deleting everything.
- The remaining findings of the v0.3.2..v0.5.0 code review (a labels
  module, a stray semicolon, starting-flag tokens, memoised chat parsing).

## [0.5.1] - 2026-10-09

Patch release with the fixes from a code review of everything that landed
between v0.3.2 and v0.5.0.

### Fixed

- A breakout deadline no longer restarts its countdown timer every second:
  the effect that drives it depended on the state it wrote, so each tick
  tore the interval down and set it up again.
- Moving a participant into or out of a breakout room now reports a relay
  refusal as a toast with the reason, instead of failing silently with the
  person left where they were.
- Learning resources without a labelled resource type no longer break the
  server-side link preview when the event carries a malformed tag.
- A Bible reference whose verse list opens with a range ("Mt 5,3-12.14")
  now links to die-bibel.de like the other Loccum forms.

## [0.5.0] - 2026-10-08

### Added

- **Breakout rooms for channel calls.** A host or co-host opens 2 to 8
  rooms from the participant panel, assigns people at random or by hand,
  sets an optional deadline and sends everyone there; "Alle zurückholen"
  brings them back. People are moved between rooms from the host panel,
  late joiners are distributed automatically or see a banner with the
  rooms, guests take part with their guest link, and a co-host who inherits
  the host seat takes the session over. Rooms are ephemeral NIP-29 groups
  that the relay cleans up on its own (see `docs/nips/nip29-ephemeral-groups.md`);
  the groups relay must run pyramid `edufeed-v1.16` or newer.
- **Broadcasts to all rooms.** "Nachricht an alle Räume" from the host
  panel, automatic countdowns at 5, 2 and 1 minutes before the deadline,
  and a heads-up before the rooms are closed; shown as a toast and a line
  in each room's call chat.
- **Paste and drop files into every chat composer.** Images and files from
  the clipboard or dropped onto the composer are uploaded and attached.
- **User guide links** from the account menu, Termi and the landing footer.

### Changed

- The side column of a call has two tabs, Teilnehmende and Breakout-Räume,
  so role changes and mutes stay reachable while rooms are open.
- The breakout deadline is a dropdown: with a limit it offers +5, +10, +15
  minutes and "Zeitlimit entfernen", without one "In 5/10/15 Min beenden"
  and a custom duration.
- The chat composer field stretches to the full width of the input bar.

### Fixed

- Communities without a displayable profile no longer show as "Unknown" in
  the landing page carousel.
- A failed meeting deletion says why (the relay's reason); together with
  pyramid `edufeed-v1.16`, meetings older than two hours can be deleted
  again.
- The guest call page shows the channel name instead of a raw group id,
  also while switching into a breakout room and back.
- The call stage's header buttons no longer overflow into the chat column
  at medium widths.

### Relay (pyramid fork, deployed to groups.edufeed.org)

- `edufeed-v1.12` ephemeral groups with relay-side deletion and kind 20002
  call broadcasts; `edufeed-v1.13` a channel's call pass is valid in its
  breakout rooms; `edufeed-v1.14` breakout rooms belong to their
  community endpoint; `edufeed-v1.15` rooms survive being briefly empty,
  tombstones for relay-side deletions, a working groups logger;
  `edufeed-v1.16` addressable events escape the two-hour deletion rule.

## [0.4.0] - 2026-10-08

### Added

- **Pre-join lobby for calls.** Before joining a channel call, members and
  guests see a mirrored self-preview with a microphone level meter, pick
  camera, microphone and speaker, choose whether to start with camera or mic
  on, and set the background effect (none, blur, presets or a stored custom
  image). The choices are remembered per device; the call token is only
  requested on "Beitreten".
- **Participant list in the call.** A "Teilnehmende (N)" button opens a list
  of everyone in the call with mic, camera, hand, guest and listen-only state
  and the per-person actions (pin, volume); beside the tiles on a wide stage,
  in their place on a phone.
- **Call layouts.** An "Ansicht" picker with Raster, Fokus (one spotlight and
  a strip), Nebeneinander (two spotlights, e.g. two screen shares) and
  Sprecher (follows the active speaker); full screen on camera tiles; a tile
  cap of 9, 16 or 25 per page with a pager, tiles off the current page render
  no video. Remembered per device.
- **Host and co-host roles.** The person who scheduled or started the call is
  the host; co-hosts come from the meeting's participant role or are
  promoted in the participant list. Hosts and co-hosts can mute, stop the
  camera or screen share of, and remove a participant through a relay
  endpoint; badges show the roles. Needs the groups relay at edufeed-v1.11.
- **Share tab or system sound with a screen share** ("Ton teilen" in the
  screen-share menu, off by default); browsers that deliver no audio get a
  hint instead of an error.
- **Call chat:** emoji picker with `:shortcode:` autocomplete and the user's
  custom emoji packs, reply-to with a quote, @mentions of call participants
  (with a count badge and a toast while the chat is hidden), private 1:1
  messages ("An: <Name>"), and file sharing through LiveKit byte streams —
  files go peer to peer, are never stored on a server and vanish with the
  call. A close button in the panel, Escape closes an empty composer. The
  composer now has its own full-width row with the tools below it.
- **Edit scheduled channel meetings** (author only). The guest link keeps
  working after a reschedule, the channel gets a "Termin verschoben" notice
  and invitees a DM, and the .ics carries SEQUENCE and LAST-MODIFIED so a
  re-import replaces the old entry.
- **Guest links in channels whose calls are off.** Scheduling a meeting there
  switches calls on first; members are told an admin has to enable calls.
- **In-app issue reporting.** "Feedback & Fehler melden" in the account menu
  and a "Fehler melden" button on the render error card file a public NIP-34
  issue against the edufeed-app repository with route, version, user agent
  and the error prefilled (logged-in users).
- **Invite QR code and link** for communities: the membership pane shows the
  join link with a QR after minting a code, open communities get a "Community
  teilen" card in settings, and a logged-out visitor with a join link is asked
  to sign in and lands in the prefilled join dialog.
- **Follow and unfollow from the profile hover card.**
- **NIP-92 `imeta` tags for images in articles** (URL, type, hash, dimensions,
  alt); the reader uses dimensions and alt text.
- **Content type chips in the community feed** and **clickable links with
  previews and an unread dot in the call chat**.
- **Calendar form:** the end time follows the start time.
- Draft spec for opt-in online presence in NIP-29 groups (`docs/nips`).

### Changed

- The camera button shows a struck-through icon while the camera is off.
- "Aus meiner Liste ausblenden" sits in its own section directly above
  "Kanal verlassen" in the channel menu.
- Declining a join request now publishes a deletion on the group relay, so
  the request no longer reappears on other devices or for other admins
  ("Ablehnen").
- The channel wizard's people picker searches profiles and admits an outsider
  to the community first, so people outside the community can be invited into
  a channel.
- Calmer event card meta and attendee line in the calendar.

### Fixed

- A logged-in channel member who opens a guest link joins as a member and
  gets the member leave dialog.
- Creating a moderated community no longer fails for a creator without a
  cached profile (the e2e specs for it run again).
- Learning resources with several resource types show all of them on cards,
  detail pages, link previews and embeds.
- In the resource wizard, the AI keyword badge no longer offers a no-op merge
  once the user holds every suggested keyword; the preview shows every
  keyword and keeps a stable cover colour.
- Bible references are linked in every publication, not just the first.
- Calendar edits keep tags the form does not manage.
- Wiki articles with Djot autolinks render instead of falling back to raw
  text.
- Received call files never trust the sender's MIME type: only raster images
  are previewed, everything else is an opaque download.

### Infrastructure

- CI reuses the published `:sha-<sha>` image for a release tag instead of
  rebuilding the identical commit.

## [0.3.4] - 2026-10-07

### Fixed

- **Actions after switching accounts used the previous account's lists.**
  Joining a single community right after switching to another account
  republished the previous account's whole communities list under the new
  account's key, and the new account's own list was lost. Following people,
  bookmarks and mutes were affected the same way. Actions now always read the
  lists of the account that signs them. (Until this fix is deployed, reload
  the page after switching accounts.)

## [0.3.3] - 2026-10-05

### Added

- **Event attributes for educational events.** The event form gets
  registration required (yes/no), cost (free, or an amount and currency),
  format (Präsenz / Online / Hybrid) and Bildungsstufe (the KIM
  educational-level vocabulary). They are shown as badges on the event,
  using the tags the Edufeed working group agreed on (`registrationRequired`,
  `price`, `eventAttendanceMode`, `educationalLevel:*`). Online events get
  an "Online-Ort" location field and no map.
- **Hashtags on events.** Events can be tagged in the create and edit form.
- **Event website link.** The first link of an event is shown as a
  "Zur Veranstaltungsseite" button next to date and time; further links stay
  under "Weitere Links".
- **Filters in community calendars.** Search, tag and people filters now
  work in a community's calendar too.
- **"Board erstellen".** The Boards tab and community boards link to the
  Kanban editor to create a new board.
- **Camera backgrounds in calls.** Blur, three built-in images or your own
  image, processed in your browser; the choice is remembered per device.
- Participants can have the role "Besucher:in" (attendee); roles are shown
  translated on the event page.

### Changed

- The "Personen" tab on Discover comes right after "Alle", and its cards show
  the NIP-05 address and a short bio.
- Calendar lists of a person, a calendar or a community open on "Alle"
  (upcoming and past) instead of one month.
- A new event ends on the day it starts, and its end date follows the start
  date until changed by hand.
- The RSVP section is called "Teilnahme anzeigen" and says that it is not a
  registration with the organizer.
- Learning resources: a creator linked to a Nostr profile always shows the
  profile's name; "Ohne Profil-Verknüpfung, nur Name" lets you enter a
  different name instead.

### Fixed

- Editing an event no longer deletes its hashtags.
- "Bearbeiten" in the event preview opens the edit form instead of seemingly
  doing nothing.
- The list and map buttons of a community calendar no longer jump to the
  community's home page, and the calendar no longer always opens as a grid.

## [0.3.2] - 2026-10-05

### Fixed

- Hovering a sender in the call chat opens their profile card next to the
  name again, instead of in the top-left corner of the window.

## [0.3.1] - 2026-10-05

### Added

- **Connection status.** While something is wrong, a small amber or red dot
  appears on the avatar (on phones: on the menu button). The account menu's
  new "Verbindung" entry opens a window with the internet state, a signing
  app that keeps the app waiting, and every one of the app's own servers
  with its state and what it serves. Logged out, a dot next to "Login"
  opens it; on mobile community pages a quiet one-line strip does. Public
  relays from other people's relay lists are not checked.
- **Help with slow remote signing.** A bunker signature still pending after
  8 seconds shows a hint to open the signing app; on phones it mentions
  energy saver mode, which holds these requests back. A signer that never
  answers now ends in an explained error instead of a generic one.

### Changed

- Untitled call guest links are listed as "Einladungslink · erstellt
  14:32" instead of a bare time.

### Fixed

- Starting a call with a bunker could sit on "Zugang wird angefragt…"
  for 90 seconds with no way out. The request now has a Cancel button and
  gives up after 45 seconds (a later signature would be refused by the
  relay anyway).

## [0.3.0] - 2026-10-03

### Added

- **Guest links for channel calls.** Anyone in a call can create a link
  (`/call/…#code`) that lets a person without an account join that one
  call under a name of their choice — never as a channel member. Links can
  be named, expire on their own and can be revoked from the invite dialog.
  Guests get the call chat, a "Gast" badge and
  clear "link no longer valid", "removed" and "call ended" pages. Needs
  pyramid edufeed-v1.9 or newer on the groups relay.
- **Scheduled meetings in channels.** "Termin planen" in a channel's ⋯ menu
  creates a meeting (NIP-52, kept on the group relay only), optionally with
  a guest link valid from 15 minutes before the start, and invites people
  by DM (only non-members get the guest link). The channel shows a meeting
  card and an upcoming bar, both with .ics download; the guest page counts
  down and becomes joinable on its own; the community calendar lists the
  meetings of its channels. Private-channel meetings never reach the
  personal calendar, feeds or the local cache.
- **In-call polish.** An ephemeral call chat (late joiners see earlier
  messages, downloadable as .txt), raised hands ordered by when they went
  up with the order on the ✋ pill, custom emoji reactions via the full
  emoji picker, tiles you can rearrange by drag or Alt+arrow, a running-call
  pill on channel cards and in the sidebar that joins in one click,
  confirmations before switching or leaving a call, and a call dock that
  sits in the page instead of floating over content.
- **Agents page** (behind `AGENTS_ENABLED`). Pair the Edufeed desktop
  companion over NIP-46, edit an agent's persona and record (kinds
  30175/30177), and see an "Agent" badge and presence in group chat.

### Changed

- **Channel navigation.** A breadcrumb leads back to the channel list, one
  channel list looks the same at every width (with "Allgemein" first),
  "Kanal verlassen" sits in the ⋯ menu behind a confirmation, and the
  community header shows members and followers clearly.
- **Calls:** non-members of an open channel can listen to a running call
  but not start one.
- **`/api/enrich` talks to nope-mcp** (formerly amb-mcp) and reads
  `NOPE_MCP_*` variables; the old `AMB_MCP_*` names still work.

### Fixed

- Community pages (`/c/…`) mount once instead of once per breakpoint, so a
  single click (e.g. Follow) no longer publishes twice.
- The community list is never rebuilt from an empty answer: when relays stay
  silent, joining or leaving says the list is unavailable instead of
  overwriting it.
- Join requests held by another of your accounts offer an account switch
  instead of a read that cannot succeed.
- A DM you send outside the composer (such as a meeting invitation) no
  longer shows up as unread or as a message request.
- Weekday and month names in the calendar follow the app language.

### Deprecated

- **`CALENDAR_LOCALE` is ignored.** Calendar weekday and month names now
  follow the app language (German UI: "Mo Di …", "Oktober"; English UI:
  "Mon Tue …", "October") instead of a deployment-wide locale. Deployments
  that still set the variable keep working; it can be removed.

## [0.2.0] - 2026-09-29

### Added

- **Calls live in group channels.** Live audio/video follows the NIP-29 AV
  spec: a channel with calls switched on gets a call button in its header,
  the relay (groups.edufeed.org) hands out the LiveKit token and publishes
  who is in the call (kind 39004). Admins can switch calls on for a channel
  with one click. The call keeps running while you move around the app — a
  small dock brings you back — and it offers raised hands, reactions,
  per-person volume, remembered devices, join/leave sounds and readable
  camera/microphone errors. On wide screens the chat opens beside the call,
  and in Chrome/Edge the call can move into its own always-on-top window.
- **@mentions everywhere.** Typing `@` in notes, comments, forum threads,
  articles, wiki pages, community chat, group chat and DMs opens a people
  picker; the pick shows as an @Name chip, is stored as a `nostr:npub…`
  reference, p-tags the person (except in DMs) and reaches their inbox.
  Rendered text shows @Name for mentions.
- **The full emoji set.** All Unicode emojis with search in the interface
  language (German keywords work alongside `:shortcodes`), skin tones, a
  "Zuletzt verwendet" row and country flags on Windows via a self-hosted
  flag font. The imprint page lists the third-party credits and licences.
- **Configurable Discover tabs.** `DISCOVER_CONTENT_TYPES` chooses which
  content types /discover offers; the "All" tab appears when at least two
  feed types are enabled.
- **New groups get UUID ids,** so Buzz clients can address them.
- **Metadata forms guide** (`docs/guides/metadata-forms.md`) documenting forms
  as Nostr events for outside review.

### Changed

- **Profile search finds new edufeed accounts.** The default profile search
  relays are Brainstorm plus `wss://amb-relay.edufeed.org`, and search reads
  NIP-50 extensions from both NIP-11 spellings; lens-gated search relays get
  `include:spam` when no observer is configured.
- **Channel header buttons** use the regular button size and the settings
  icon.

### Removed

- **Communikey Meet** (kind 30312/10312 rooms and the operator token proxy) —
  calls now live in NIP-29 channels.

### Fixed

- **Lists:** adding people searches beyond your follows, and list pages no
  longer crash with `state_unsafe_mutation`.
- **Discover search:** Enter searches the typed text instead of picking the
  first suggested profile.

## [0.1.9] - 2026-09-28

### Fixed

- **Profiles can be set up from scratch.** Saving the profile editor failed
  with "Unable to find profile metadata" for accounts that had never
  published a profile (kind 0) — including the ones Termi's "set up your
  profile" hint sends there. The editor now creates the profile in that case,
  and still refuses to overwrite one that turns up on a relay meanwhile.

## [0.1.8] - 2026-09-22

### Added

- **Group invites arrive as a card.** A NIP-29 group invite sent as a DM is
  rendered as an invite card with a "Beitreten" button that keeps the join
  link (and its invite code) intact, plus a copyable `naddr` for other
  clients. Invite conversations count as known senders, so they show in the
  main DM list with an unread badge instead of being shelved in the
  "Anfragen" folder. Inviting someone by DM uses the same contact search as
  adding a member directly (profile search, pasted npubs, roster excluded).

### Fixed

- **Cached content is refreshed and deletions stick.** The persistent event
  cache never asked a relay again once it held a profile, community
  definition, article, resource or calendar event, and it never learned
  about deletions by other authors. Cached replaceable events are now
  revalidated once per session (instant paint from the cache, newer version
  from the relays), and network deletions are mirrored into the cache. This
  also closes a moderation gap: the dashboard community feed could keep
  gating against an outdated community definition and show calendar items
  from authors who are not on a moderated community's roster.
- **Community owners can moderate the roster.** Adding, removing and
  inviting members from the community's members surfaces was signed by the
  active account, which the groups relay refuses unless that account is a
  group admin. The key-holding owner now signs these actions as the
  community key; the invite DM itself still comes from the active account.

## [0.1.7] - 2026-09-22

### Added

- **Browser notifications for DMs and inbox items.** One per-device opt-in on
  `/settings` ("Notifications") asks for the browser permission and then
  fires an OS toast for a new DM from a known sender and for new inbox items
  (reactions, comments, replies, mentions, waves, RSVPs, poll votes, form
  responses, group adds). Toasts name the sender and what happened, never the
  content; a click focuses the app on the conversation or the inbox. Concord
  private channels use the same opt-in and the same suppression rules
  (nothing while the target surface is visible, 30 s throttle). The inbox now
  keeps a standing relay subscription, so the bell badge updates live instead
  of on the next reload.
- **NIP-05 handle grants are announced.** An approved `@edufeed.org` address
  shows up as a pinned "Deine Adresse ist fertig" row in the bell dropdown,
  on `/inbox` and on the dashboard inbox card, counts on the bell, and can be
  activated with one click. After activation a short modal explains what the
  address enables. Previously the grant was only visible inside the Termi
  assistant.
- **Welcome DM after a handle grant speaks the applicant's language.** The
  application stores the applicant's UI locale, the approval DM is rendered
  in that locale (falling back to the deployment's base locale, never the
  admin's), and the text introduces who is writing and on behalf of whom.
  Configured membership admins carry an "Official" badge wherever a DM sender
  is shown.
- **People search on Discover.** A "Personen" tab searches profiles (own
  follows, locally known profiles, then a NIP-50 relay search), ranked by
  NIP-85 web-of-trust scores with an "im Vertrauensnetz" badge. The navbar
  search icon lands there.
- **Calendar participants.** The "Mitwirkende" field accepts plain names for
  people without an npub (stored as an app-specific `participant` tag with the
  NIP-52 slot layout) and searches non-followed profiles on the configured
  search relays, ranked by web of trust. New config: `PROFILE_SEARCH_RELAYS`
  (default Brainstorm's WoT search relay), `PROFILE_SEARCH_OBSERVER`,
  `TRUST_ASSERTION_RELAYS`, `TRUST_ASSERTION_PROVIDERS`.
- **Community keys on the profile page.** `/p/<npub>` of a community key
  shows a "Community" chip next to the name and an "Open community" button
  that leads to `/c/<npub>`. In the other direction, the community name and
  avatar in the community hero open a profile hover card and link to the
  key's profile page.
- **`stil` deployment theme reworked for the editorial design.** The theme
  now restates every editorial alias (hero, band, accent slots, display and
  script fonts) with transferkiosk.net's palette and self-hosted Open Sans,
  so THEME_DEFAULT_LIGHT=stil deployments follow the new layout instead of
  the pre-redesign look. A drift test fails when a new alias lands on `:root`
  without a `stil` counterpart.

### Fixed

- **"Mark all as read" in the inbox sticks.** The read marker (kind 30078)
  was written to the author's write relays and read back from the lookup
  relays, had no local copy, could be wiped by one undecryptable emission,
  and was dropped on re-init. It is now mirrored in localStorage, published
  to both relay sets, merged so nothing moves backwards, and (follow-up) its
  value lives in the event's `created_at` with a constant content, so it
  needs no encryption and is published at most every 10 minutes per pubkey.
  Bell clicks no longer raise signer prompts.
- **`nostr:` mentions in a DM body no longer become conversation
  participants.** The kind-1 content pipeline p-tagged every pubkey behind a
  `nostr:` pointer, including the author of an naddr, so a group invite
  turned the groups relay's own identity into a third participant (and sent
  it a gift-wrap copy). New DMs now carry exactly the named recipients.
- **Upcoming-event rails show one row per appointment**, and all-day events
  (kind 31922) no longer show a fabricated clock time. A publisher that flips
  an appointment between kind 31922 and 31923 under the same d-tag produced
  duplicates; the rails now collapse them.

### Removed

- **The kind 30382 community migration modal.** The one-off bridge to the
  kind 30000 follow set has done its job. Its "done" flag was keyed by
  `APP_NAME`, so every whitelabel deployment re-asked every user, and "Skip"
  wrote nothing. The service, modal, messages and the per-login relay queries
  are gone; existing migration flags stay on the relays unread.

## [0.1.6] - 2026-09-19

### Fixed

- **Profile metadata reaches other clients again.** A kind 0 written here went
  only to the author's NIP-65 write relays, so a profile could end up on a
  single relay — invisible to every other client, which then showed its own
  placeholder, and a name retyped there overwrote the fields set in Edufeed.
  Identity events (kinds 0, 3, 10002, 10050, 10063) now also go to the
  configured profile indexers, relay-list indexers and fallback relays, as
  NIP-65 asks and as other clients do. Once per session the app additionally
  re-publishes the account's own kind 0 and kind 10002 to those relays, which
  heals profiles that are already stranded (nothing is signed again, so it
  works for read-only logins too).
- **Profile page naming:** `display_name` is preferred over `name` (NIP-24),
  and a profile without either now shows its shortened npub instead of the
  hardcoded "Anonymous User", which read like a real name in other clients.

## [0.1.5] - 2026-09-18

### Added

- **Direct messages**
  - NIP-17 encrypted file messages (kind 15) are decrypted and rendered:
    images inline, everything else as a download card. Previously the app
    only ever read kind 14 inside a gift wrap and dropped the rest silently,
    so files other clients showed were invisible here.
  - Private reactions (kind 7 inside a gift wrap) appear as badges on the
    message they target, custom emoji included.
  - A file message now shows readable preview text in the conversation list
    and the inbox dropdown instead of a raw Blossom URL.
- **Chat input:** typing `:` opens an emoji autocomplete covering the
  standard set plus the user's own custom emojis (kind 10030 and its packs).
  Arrow keys and Tab move through it, Enter inserts, and a custom emoji shows
  as its image inline in the composer. Available in DMs and in community
  group chats.
- **Licensing**
  - AI provenance and training tags on kind 1063 aligned with the twillo
    model, including the EU marking in the image license overlay.
  - A readable license info card on hover, replacing the old tooltip.
- **Community:** reworked create-community wizard, with profile search for
  picking members.
- **Forms**
  - A DOI field type with Crossref auto-fetch, and DOI prefill on the
    publication page (title, licence, URL and PDF).
  - Form preview, per-field descriptions and optional fields.

### Fixed

- **Direct messages**
  - Messages could disappear in two separate ways, both silent. A gift wrap
    that threw once during unlock was blacklisted in localStorage and never
    retried, and a gift wrap whose seal had been restored from cache but
    never opened was treated as done and never reached the signer. Both are
    fixed, and unlock failures now surface a retry prompt instead of hiding
    the message.
  - Custom emojis render in NIP-17 DMs.
- **Groups**
  - Admins are no longer asked to re-sign the same kind-9000 roster
    reconciles on every visit; refusals are remembered.
  - The community rail no longer loops on a NIP-11 race.
  - Kind-39000 channel metadata is pinned to the relay it came from.
- **Community:** the section access gate now also applies to the calendar and
  to discover, which were reading ungated.
- **Comments:** kind-1111 replies whose parent is a kind-1 note thread
  correctly.
- **Lists:** the Lists tab no longer dies with `state_unsafe_mutation`.
- **Discover:** NIP-50 search results are merged by per-relay rank, with a
  relevance sort.
- **Rail:** a drop landing in the gap between two icons is accepted instead
  of being ignored.
- **Auth:** the login modal closes after switching accounts.
- **AMB:** a cover image hash is recovered from its Blossom URL.
- **Layout:** the community sidebar keeps its registration across navigation.
- **Cards:** adaptive cover frames stop cropping square and portrait images.
- **Moderation:** Unicode lookalikes are folded before muted-word matching,
  closing a homoglyph bypass.
- **Membership:** wished NIP-05 handles are normalised to lowercase.
- **Highlights:** a highlight spanning a line break matches again.

### Changed

- `CLAUDE.md` trimmed of content derivable from the code, with task-specific
  material moved into skills.

## [0.1.4] - 2026-09-09

### Added

- **Groups / NIP-29 rooms**
  - Polls in group rooms (NIP-88, wire-compatible with Armada), and the poll
    card layout is now shared between community feeds, group rooms and
    Concord channels, including a "Change vote" action.
  - File upload in room chat: files go to the user's Blossom server, images
    render inline, other files as a download card (Armada-compatible `imeta`).
  - Deep links to a specific room (`?channel=`) and to a specific message
    (`?message=`).
  - Admins can delete chat messages (kind 9005); deletions performed in other
    clients are honoured too.
  - Hidden (unlisted) rooms in the channel creation wizard, with their own
    rail badge.
  - "Remove from my list" / "Add to my list" for groups that only surface
    through the personal kind-10009 list.
  - Termi hint alerts admins to pending join requests, with a Review action.
  - A notice tells people when they were added to a group.
  - The channel app picker shows only the curated apps.
- **Community:** Members and Manage Members consolidated into one section
  with inline per-row admin actions (make/remove publisher or admin, assign
  role, remove).
- **Calendar:** selected filters are encoded as URL parameters, so a filtered
  calendar view can be shared.
- **Learning resources:** a ready-made TULLU attribution (Titel, Urheber,
  Lizenz, Link, Ursprungsort) with copy action on every licensed resource.
- **Image licensing:** an "AI involvement" choice in the license modal stores
  an `ai` tag (`generated` / `modified`) on the kind-1063 attestation, and the
  EU "AI" mark is shown wherever the image appears.
- **Moderation:** NIP-51 private mute entries are honoured, deployments can
  ship instance-wide muted words on top of the user's mute list, and the
  instance spam filter is a user choice.
- **Docs:** a guide on publishing to a NIP-29 group (`docs/guides/`).

### Fixed

- **Publishing:** a persistent outbox (IndexedDB) keeps signed events until a
  relay acknowledges them and replays them on the next boot or when the
  browser comes back online, so a closed tab or stalled signer no longer
  loses an event silently. Failed publishes report that they will be retried.
- **Accounts:** switching accounts or logging out flushes the session state,
  so member-only content cannot bleed across accounts.
- **Groups:** publishers were wrongly granted the admin role on channels
  (write side) and shown admin UI (read side); both now key off moderation
  roles only, and the grants the bug wrote are reverted.
- **Groups:** duplicate join requests from the same user are consolidated
  into one row; accepting grants every requested channel at once.
- **Groups:** deleted NIP-29 channels are hidden instead of listed as
  "[deleted]".
- **Community:** content sections sort by share date instead of the original
  event timestamp, so reposts no longer sink to the bottom.
- **Community:** a signed-out visit no longer sticks to a stale community
  definition; lookup relays are resolved per request.
- **License labels:** CC deed URLs (`.../deed.de`) rendered as "CC BY 4.0 DEE".
- **Editors:** code blocks in every prose surface (editor previews, calendar
  descriptions, threads, resource descriptions) had an ink-on-ink background.
- **Channels:** the create-channel dialogs autofocus the name field and get
  consistent spacing.

### Performance

- The root layout lazy-loads the global modals, sidebars and the Termi
  assistant. A first visit to `/` preloads 119 chunks instead of 290
  (0.87 MB instead of 2.5 MB of JS before hydration).
- Modulepreload hints moved from a ~20 KB `Link` response header into the HTML
  head; the Docker health check and CI smoke probe run at Node's default
  header limit again.
- Paraglide 2.16 → 2.25: tree-shakeable message modules and a single inlang
  compile per build.

### Changed

- `.env.example`: `AMB_RELAYS` defaults to `wss://amb-relay.edufeed.org`
  instead of a localhost relay, so a fresh clone gets a working educational
  search.

## [0.1.3] - 2026-09-02

First canonical release, cut after the move to a main-based release workflow
(2026-08-31). The three earlier tags each lack a piece of the CI/deploy fix
stack and cannot ship themselves through CI.

- Groups (NIP-29): role management, creation explainers, favourite channels,
  join-request handling.
- Pads: full-height layout with deep links.
- Bookmarks: editing and document page references.
- Relay input normalising; calendar date, deletion and ICS fixes.
- DM spam shelved off all notification surfaces.
- Learning resources: multiple learning resource types; images in the no-URL
  uploader.
- CI/deploy: 6144 MB build heap cap, health probes tolerant of the large
  modulepreload `Link` header, 400 MB chown layer removed from the image.

## [0.1.2] - 2026-09-01

- CI: raise the health probes' header limit.

## [0.1.1] - 2026-09-01

- CI: raise the build heap cap to 6144 MB.

## [0.1.0] - 2026-09-01

- First tagged release on `main`.

[0.1.9]: https://git.edufeed.org/edufeed/edufeed-app/compare/v0.1.8...v0.1.9
[0.1.8]: https://git.edufeed.org/edufeed/edufeed-app/compare/v0.1.7...v0.1.8
[0.1.7]: https://git.edufeed.org/edufeed/edufeed-app/compare/v0.1.6...v0.1.7
[0.1.6]: https://git.edufeed.org/edufeed/edufeed-app/compare/v0.1.5...v0.1.6
[0.1.5]: https://git.edufeed.org/edufeed/edufeed-app/compare/v0.1.4...v0.1.5
[0.1.4]: https://git.edufeed.org/edufeed/edufeed-app/compare/v0.1.3...v0.1.4
[0.1.3]: https://git.edufeed.org/edufeed/edufeed-app/compare/v0.1.2...v0.1.3
[0.1.2]: https://git.edufeed.org/edufeed/edufeed-app/compare/v0.1.1...v0.1.2
[0.1.1]: https://git.edufeed.org/edufeed/edufeed-app/compare/v0.1.0...v0.1.1
[0.1.0]: https://git.edufeed.org/edufeed/edufeed-app/releases/tag/v0.1.0
