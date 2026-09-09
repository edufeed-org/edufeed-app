# Changelog

All notable changes to Edufeed are recorded here, newest first. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
the `vX.Y.Z` git tags on `main`. Each release section is assembled from the
merge commits of the nostr PRs that landed since the previous tag.

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

[0.1.4]: https://git.edufeed.org/edufeed/edufeed-app/compare/v0.1.3...v0.1.4
[0.1.3]: https://git.edufeed.org/edufeed/edufeed-app/compare/v0.1.2...v0.1.3
[0.1.2]: https://git.edufeed.org/edufeed/edufeed-app/compare/v0.1.1...v0.1.2
[0.1.1]: https://git.edufeed.org/edufeed/edufeed-app/compare/v0.1.0...v0.1.1
[0.1.0]: https://git.edufeed.org/edufeed/edufeed-app/releases/tag/v0.1.0
