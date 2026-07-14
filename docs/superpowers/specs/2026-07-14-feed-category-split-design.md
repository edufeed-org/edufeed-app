# Feed category split: Lesezeichen / Highlights / Geteilt

**Date:** 2026-07-14
**Issue:** [#45](https://git.edufeed.org/edufeed/edufeed-app/issues/45)
**Status:** approved (brainstorm 2026-07-14, revised same day: DRY/KISS pass)

## Problem

The feed's "Lesezeichen" chip is a mixed bucket: its category covers kinds
39701 (web bookmarks), 9802 (highlights), and 1111 (comments/page notes).
Reposts (kind 6/16) whose target falls in this category are typed
`'bookmarks'` by `mergeRepostsIntoFeed`, but the feed template has no render
branch for that type — the entries render as headless "hat geteilt" bylines
(issue #45). Live data from the reporter's 544 follows shows the category is
dominated by shares of highlights/comments; genuine kind-39701 bookmarks are
nearly nonexistent (1 event).

## Decision

Split the category three ways and give reposts their own first-class section:

| Chip | Content |
|---|---|
| Notizen | kind 1 root notes (unchanged) |
| Kalender | 31922 / 31923 (unchanged) |
| Ressourcen | 30142 (unchanged) |
| Artikel | 30023 (unchanged) |
| **Lesezeichen** | kind 39701 events + the per-URL / per-event-ref groups (bookmarks, page notes, and highlights *about* a link or referenced event) — "links my follows engage with" |
| **Highlights** (new) | individual kind 9802 events |
| **Geteilt** (new) | every kind 6/16 repost from follows, regardless of target kind |
| Umfragen | 1068 (unchanged) |

## Category model

- `FEED_CATEGORIES` in `src/lib/helpers/profile-feed.js` gains `highlights`
  (kinds `[9802]`); the `bookmarks` category keeps kinds `[39701, 1111]`;
  `kindToFeedCategory(9802)` returns `'highlights'`.
- `shared` is **not** a kind-driven category: it exists only in the chips
  config. Membership is decided by a single pure predicate:
  `entryMatchesCategory(entry, id)` — `'shared'` matches `!!entry.repost`,
  every other id matches `entry.type` (group entries `bookmark-url` /
  `bookmark-ref` match `'bookmarks'`). `entry.type` remains the single
  content category exactly as `mergeRepostsIntoFeed` assigns today; no
  entry data-model change.
- URL/event-ref grouping (`groupByUrl` / `groupByEventRef`) is unchanged: a
  highlight that references a URL still appears inside that URL's group under
  Lesezeichen *and* individually under Highlights.

## Filter semantics (dual membership)

The #35 solo/hide store and chips are reused; only the matching becomes
set-based:

- **Solo X**: entry visible iff `X ∈ categoriesOf(entry)`.
  - Solo *Artikel* → authored **and** shared articles.
  - Solo *Geteilt* → all reposts, any target kind.
- **Hide X**: entry hidden iff `X ∈ categoriesOf(entry)` (any hidden member
  kills the entry).
  - Hide *Geteilt* → no reposts anywhere.
  - Hide *Artikel* → no articles anywhere, including shared ones.
- Solo still wins over hidden; soloing un-hides; hiding the solo'd category
  clears the solo (unchanged from #35).

The pure helpers in `profile-feed.js` (`toggleSoloCategory`,
`toggleHiddenCategory`, `effectiveActiveCategories`) stay; solo and hide
filtering both route through the one `entryMatchesCategory` predicate
(visible iff some active category matches; with a solo set, visible iff the
solo category matches).

## Rendering (fixes #45 by construction — in BOTH feed surfaces)

- **Shared category→card resolver.** `RichFeedEntry` (community feed) also
  branches on `kindToFeedCategory` and already lacks a bookmarks branch —
  the same headless/blank failure class exists there today. Extract ONE
  shared resolver component (entry → card component + props) used by both
  `ProfileFeedView` and `RichFeedEntry`, so categories are added in exactly
  one place.
- Repost entries render `SharedByLine` plus the proper card for the target
  kind. Existing branches (notes, calendar, resources, articles, polls)
  stay; new branches reuse existing components:
  - kind 9802 target → single-highlight card extracted from
    `EventHighlightCard`'s featured-highlight styling, reading tags via
    applesauce helpers (`getHighlightSourceUrl`,
    `getHighlightSourceAddressPointer`, `getHighlightAttributions`) — no
    hand-parsed highlight tags;
  - kind 1111 target → reuse `PageNoteItem` (existing kind-1111 preview).
- **Safety net:** the resolver returns null for unknown categories and the
  wrapper renders byline+card only when a card exists — a share byline can
  never render without a body, in either surface.

## Chip row UI

Single-line horizontal scroll: `flex-nowrap` + `overflow-x-auto` on the chip
container, hidden scrollbar (`scrollbar-width: none` / webkit equivalent),
and a right-edge gradient fade as the scroll affordance. Chips keep the solo
body + eye button interaction from #35 unchanged.

## Scope and non-goals

- New paraglide keys for the two new chips (de: Highlights, Geteilt; en:
  Highlights, Shared) and their solo/hide aria labels.
- Feed-state cache is in-memory only — no persisted-state migration.
- Profile pages (`showFilters=false`) only inherit the new render branches;
  their tab structure is untouched.
- Loaders already fetch all involved kinds (bookmark kinds in
  `ALL_FEED_KINDS`, reposts via the kind 6/16 model) — no loader changes.
- Non-goals: bookmark page redesign, new kinds, chip reordering/pinning.

## Testing

- Unit (TDD order): `entryMatchesCategory` predicate first (solo Artikel
  includes shared articles; hide Artikel removes shared articles; hide
  Geteilt removes all repost entries; solo Geteilt shows only repost
  entries; group entries match bookmarks), then the resolver mapping incl.
  9802/1111 branches and the null-for-unknown safety net; URL-group
  composition unchanged.
- Component: chip row renders all 8 chips inside the scroll container; solo
  and hide interactions unchanged; a repost-of-highlight entry renders
  byline + highlight card; RichFeedEntry renders a card (not blank) for all
  categories.
