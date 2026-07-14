# Feed category split: Lesezeichen / Highlights / Geteilt

**Date:** 2026-07-14
**Issue:** [#45](https://git.edufeed.org/edufeed/edufeed-app/issues/45)
**Status:** approved (brainstorm 2026-07-14)

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
  (kinds `[9802]`) and `shared` (no direct kinds — membership is derived from
  repost metadata, see below). The `bookmarks` category keeps kinds
  `[39701, 1111]`; `kindToFeedCategory(9802)` returns `'highlights'`.
- Each feed entry carries a **category set** rather than a single type:
  `categoriesOf(entry) = { entry.type } ∪ ({ 'shared' } when entry.repost)`.
  `entry.type` remains the content category (repost-only entries keep the
  target's category, exactly as `mergeRepostsIntoFeed` assigns today).
- URL/event-ref grouping (`groupByUrl` / `groupByEventRef`) is unchanged: a
  highlight that references a URL still appears inside that URL's group under
  Lesezeichen *and* individually under Highlights. Group entries
  (`bookmark-url` / `bookmark-ref`) belong to the `bookmarks` category for
  filtering purposes.

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
`toggleHiddenCategory`, `effectiveActiveCategories`) stay; `filterFeedItems`
/ the entry filter in `ProfileFeedView` switch from single-type membership to
set intersection.

## Rendering (fixes #45 by construction)

- Repost entries render `SharedByLine` plus the **proper card for the target
  kind**. Existing branches (notes, calendar, resources, articles, polls)
  stay; new branches:
  - kind 9802 target → individual highlight card (adapt the existing
    `EventHighlightCard` used by event-ref groups, or extract a
    single-highlight variant);
  - kind 1111 target → compact comment preview (reuse `NoteCard`-style
    rendering with the comment's content).
- **Safety net:** an entry whose type has no matching render branch is
  skipped entirely — a share byline must never render without a body. This is
  enforced by resolving the card component *first* and rendering the
  byline+card wrapper only when a card exists.

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

- Unit: set-based solo/hide semantics (solo Artikel includes shared
  articles; hide Artikel removes shared articles; hide Geteilt removes all
  repost entries; solo Geteilt shows only repost entries), category-set
  derivation, repost→card mapping incl. 9802/1111 branches, no-headless
  safety net (unknown type ⇒ entry skipped), URL-group composition
  unchanged.
- Component: chip row renders all 8 chips inside the scroll container; solo
  and hide interactions unchanged; a repost-of-highlight entry renders
  byline + highlight card.
