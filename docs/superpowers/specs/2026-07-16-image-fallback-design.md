# App-wide Broken-Image Fallback — Design

**Date:** 2026-07-16
**Status:** Approved

## Problem

Broken remote images show the browser's dead-image icon in many places (note-card
avatars, badges, covers). Two root causes:

1. `ImageWithFallback.svelte`'s terminal fallback is **robohash.org** — an external
   network service that can itself fail (adblocker, offline, service down). When it
   does, the user sees a broken `<img>`.
2. ~40 files render raw `<img>` tags with dynamic (event-derived / external) `src`
   and bypass the fallback component entirely (`BadgeThumb`, `FeedCard`,
   `ThreadCard`, previews, emoji, …).

## Decisions (user-approved)

- Guaranteed final fallback = **local placeholder** (inline SVG / styled div,
  ships with the app, cannot fail). No layout collapse.
- Migration scope = **network images only**. Local static assets (logo, bundled
  landing hero, imprint) and local blob-URL upload previews stay plain `<img>`.
  No lint rule.
- Robohash stage remains **for avatars only**. Covers, badges, previews and other
  content images go straight to the local placeholder.
- Approach = **enhance the existing `ImageWithFallback`** (no new component, no
  Svelte action).

## 1. `ImageWithFallback.svelte`

Type-aware fallback chain with an unfailable local terminal stage:

| `fallbackType`                              | Chain                                            |
| ------------------------------------------- | ------------------------------------------------ |
| `avatar`                                    | proxy → original → robohash → local placeholder  |
| `event`, `community`, `banner`, `badge`, `generic` | proxy → original → local placeholder      |

- The currently-ignored `fallbackType` prop is **revived**: it drives both the
  robohash decision and the placeholder icon. A `badge` value is added to the
  union. Existing 18 call sites already pass it and keep working unchanged.
- **Local placeholder:** when the final `<img>` stage errors, the `<img>` is
  replaced by a `<div>` with `bg-base-200` and a `text-base-content/30` inline
  SVG icon, receiving the same `class` prop so layout never shifts. Icon per
  type from the existing icon system (`src/lib/components/icons/`, adding icons
  there if missing): person silhouette (avatar), photo icon (generic/event/banner),
  award icon (badge), people icon (community).
- **New optional `fallback` snippet prop:** rendered instead of the default
  placeholder when all stages fail. Lets wrappers supply richer fallbacks
  (e.g. initial letter).

## 2. `ProfileAvatar.svelte`

- Passes a `fallback` snippet (its initial-letter div) into `ImageWithFallback`,
  so the initial letter also appears when a picture URL exists but fails to load —
  not only when the profile has no picture (fixes the reported screenshot case).
- The initial uses the real display-name first character (uppercased), falling
  back to `?`, instead of the current static message string.
- `fallbackType='robohash'` keeps robohash in the chain; `'initial'` skips it.

## 3. Migration of raw `<img>` tags

Classification rules for the ~40 files with dynamic `src`:

1. **Raw avatar `<img>` → `ProfileAvatar`** wherever a pubkey/profile is at hand:
   `ThreadCard`, `ReactionReactorsList`, `PeopleFilter`, `FeaturedAuthors`,
   `TopPublishersFilter`, `AuthorSearchDropdown`, `CreatorInput`, and similar.
   Also de-duplicates avatar markup.
2. **Content/network images → `ImageWithFallback`** with the right `fallbackType`:
   `BadgeThumb` (badge), `FeedCard` / community heroes / covers
   (event/community/banner), `LinkPreview`, `NostrPreviews/*`,
   `NostrContentRenderer` inline images (generic), `EmojiPicker`,
   `DashboardLists`, `AMBResourceView`, `MediaLightbox` (zoom behavior unchanged,
   only the error path), image-library modals.
3. **Leave as plain `<img>`:** local static assets (Navbar/Sidebar logo, bundled
   landing hero, imprint) and blob-URL previews in `AvatarUploader` /
   `BannerUploader` (object URLs the user just created).

## 4. Testing (TDD, component tests, jsdom)

Location: `src/lib/components/__tests__/`. Baseline existing tests first.

- `ImageWithFallback`: chain progression per type (avatar walks
  proxy→original→robohash→placeholder; generic skips robohash), `fallback`
  snippet rendering, **no robohash request for non-avatar types**, chain reset
  when `src` prop changes.
- `ProfileAvatar`: broken picture URL ends at the initial-letter div, never a
  broken image.
- `BadgeThumb`: broken badge image shows the badge placeholder.

No E2E — all behavior is exercisable at the component level.

## Out of scope

- Lint rule enforcing the pattern for future `<img>` tags.
- Image proxy changes (`image-proxy.js` untouched).
- Any caching / retry logic beyond the existing chain.
