# Feed Category Split (Lesezeichen / Highlights / Geteilt) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the feed's mixed bookmarks category into Lesezeichen / Highlights / Geteilt chips with dual-membership filtering, and make repost rendering headless-proof in both feed surfaces (fixes issue #45).

**Architecture:** A pure visibility predicate (`entryMatchesCategory` / `entryVisible`) in `profile-feed.js` replaces set-membership filtering; a shared `FeedEntryCard` resolver component renders the kind-specific card for single events and is used by both `ProfileFeedView` and `RichFeedEntry`; a new compact `HighlightCard` renders single kind-9802 events using applesauce highlight helpers. Spec: `docs/superpowers/specs/2026-07-14-feed-category-split-design.md`.

**Tech Stack:** SvelteKit + Svelte 5 runes, applesauce v6 (`applesauce-common/helpers` highlight helpers), Vitest (+ @testing-library/svelte, jsdom for components), Paraglide i18n.

## Global Constraints

- Work in a fresh git worktree branched from `feat/applesauce-v6` (per project memory: rebase base is that branch, copy `.env` from the main checkout, `pnpm install`).
- Svelte 5 runes only; JSDoc types, no TypeScript files.
- Every i18n string needs keys in BOTH `messages/en.json` and `messages/de.json`; never put `@` before a placeholder in a message value.
- Chip labels: de "Highlights" / "Geteilt", en "Highlights" / "Shared".
- Run `pnpm vitest run <file>` per test cycle; `pnpm run check` and `pnpm run lint` must be clean before each commit (a pre-existing `no-unused-vars` error in `scripts/delete-legacy-concept-kinds.mjs` is baseline — ignore it).
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and reference `Refs edufeed/edufeed-app#45` (final task uses `Fixes edufeed/edufeed-app#45`).

---

### Task 1: Category model + visibility predicate (pure logic)

**Files:**
- Modify: `src/lib/helpers/profile-feed.js`
- Test: `src/lib/__tests__/profile-feed.test.js`

**Interfaces:**
- Produces: `FEED_CATEGORIES` gains `{ id: 'highlights', kinds: [9802] }`; `bookmarks` becomes `kinds: [39701, 1111]`. New exports:
  - `entryMatchesCategory(entry: {type: string, repost?: object}, categoryId: string): boolean`
  - `entryVisible(entry, selection: {solo: string|null, hidden: string[]}): boolean`
- Removes: `filterFeedItems` (its only consumer is rewired in Task 4; delete its tests).

- [ ] **Step 1: Write the failing tests** — replace the `filterFeedItems` describe block in `src/lib/__tests__/profile-feed.test.js` with (and update the `FEED_CATEGORIES` id-list test to `['notes', 'calendar', 'resources', 'articles', 'bookmarks', 'highlights', 'polls']`, plus `kindToFeedCategory(9802) === 'highlights'`):

```js
import {
  // ...existing imports, remove filterFeedItems, add:
  entryMatchesCategory,
  entryVisible
} from '$lib/helpers/profile-feed.js';

describe('entryMatchesCategory', () => {
  const authored = { type: 'articles', data: { kind: 30023 } };
  const shared = { type: 'articles', data: { kind: 30023 }, repost: { sharers: ['a'] } };
  const urlGroup = { type: 'bookmark-url', data: {} };
  const refGroup = { type: 'bookmark-ref', data: {} };

  it('matches the content category by entry type', () => {
    expect(entryMatchesCategory(authored, 'articles')).toBe(true);
    expect(entryMatchesCategory(authored, 'notes')).toBe(false);
  });

  it("matches 'shared' only for entries with repost metadata", () => {
    expect(entryMatchesCategory(shared, 'shared')).toBe(true);
    expect(entryMatchesCategory(authored, 'shared')).toBe(false);
  });

  it('a shared entry also matches its content category (dual membership)', () => {
    expect(entryMatchesCategory(shared, 'articles')).toBe(true);
  });

  it("group entries match 'bookmarks'", () => {
    expect(entryMatchesCategory(urlGroup, 'bookmarks')).toBe(true);
    expect(entryMatchesCategory(refGroup, 'bookmarks')).toBe(true);
    expect(entryMatchesCategory(urlGroup, 'shared')).toBe(false);
  });
});

describe('entryVisible', () => {
  const note = { type: 'notes', data: { kind: 1 } };
  const sharedNote = { type: 'notes', data: { kind: 1 }, repost: { sharers: ['a'] } };
  const sharedArticle = { type: 'articles', data: { kind: 30023 }, repost: { sharers: ['a'] } };
  const none = { solo: null, hidden: [] };

  it('shows everything with the empty selection', () => {
    expect(entryVisible(note, none)).toBe(true);
    expect(entryVisible(sharedArticle, none)).toBe(true);
  });

  it('solo on a content category includes shared entries of that category', () => {
    const sel = { solo: 'articles', hidden: [] };
    expect(entryVisible(sharedArticle, sel)).toBe(true);
    expect(entryVisible(note, sel)).toBe(false);
  });

  it("solo 'shared' shows only repost entries, any target kind", () => {
    const sel = { solo: 'shared', hidden: [] };
    expect(entryVisible(sharedNote, sel)).toBe(true);
    expect(entryVisible(sharedArticle, sel)).toBe(true);
    expect(entryVisible(note, sel)).toBe(false);
  });

  it('solo wins over hidden (hidden list ignored while solo is set)', () => {
    const sel = { solo: 'articles', hidden: ['shared'] };
    expect(entryVisible(sharedArticle, sel)).toBe(true);
  });

  it('hiding a content category also hides shared entries of it', () => {
    const sel = { solo: null, hidden: ['notes'] };
    expect(entryVisible(note, sel)).toBe(false);
    expect(entryVisible(sharedNote, sel)).toBe(false);
    expect(entryVisible(sharedArticle, sel)).toBe(true);
  });

  it("hiding 'shared' hides every repost entry but keeps authored content", () => {
    const sel = { solo: null, hidden: ['shared'] };
    expect(entryVisible(sharedNote, sel)).toBe(false);
    expect(entryVisible(sharedArticle, sel)).toBe(false);
    expect(entryVisible(note, sel)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/lib/__tests__/profile-feed.test.js` → FAIL (`entryMatchesCategory` not exported; category list mismatch).

- [ ] **Step 3: Implement** in `src/lib/helpers/profile-feed.js`:

```js
/** @type {FeedCategory[]} */
export const FEED_CATEGORIES = [
  { id: 'notes', kinds: [1] },
  { id: 'calendar', kinds: [31922, 31923] },
  { id: 'resources', kinds: [30142] },
  { id: 'articles', kinds: [30023] },
  { id: 'bookmarks', kinds: [39701, 1111] },
  { id: 'highlights', kinds: [9802] },
  { id: 'polls', kinds: [1068] }
];
```

Delete `filterFeedItems` and add below the solo/hide helpers:

```js
/**
 * Chart-legend category membership for a feed entry (issue #45).
 * 'shared' is not kind-driven: it matches any entry carrying repost
 * metadata. Group entries (bookmark-url / bookmark-ref) belong to
 * 'bookmarks'. Everything else matches by entry type.
 * @param {{type: string, repost?: object}} entry
 * @param {string} categoryId
 * @returns {boolean}
 */
export function entryMatchesCategory(entry, categoryId) {
  if (categoryId === 'shared') return !!entry.repost;
  if (categoryId === 'bookmarks')
    return entry.type === 'bookmarks' || entry.type === 'bookmark-url' || entry.type === 'bookmark-ref';
  return entry.type === categoryId;
}

/**
 * Dual-membership visibility: with a solo set, the entry must match the solo
 * category (hidden list ignored — solo wins, mirroring the calendar filter);
 * without one, the entry is hidden when ANY of its categories is hidden.
 * @param {{type: string, repost?: object}} entry
 * @param {CategorySelection} selection
 * @returns {boolean}
 */
export function entryVisible(entry, selection) {
  if (selection.solo) return entryMatchesCategory(entry, selection.solo);
  return !selection.hidden.some((id) => entryMatchesCategory(entry, id));
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm vitest run src/lib/__tests__/profile-feed.test.js` → all pass. (`ProfileFeedView` still imports `filterFeedItems` — that compile break is fixed in Task 4; `pnpm run check` runs there, not here.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/helpers/profile-feed.js src/lib/__tests__/profile-feed.test.js
git commit -m "feat(feed): highlights category + dual-membership visibility predicate

Refs edufeed/edufeed-app#45

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `HighlightCard` — single kind-9802 card

**Files:**
- Create: `src/lib/components/bookmarks/HighlightCard.svelte`
- Test: `src/lib/components/__tests__/HighlightCard.test.js`

**Interfaces:**
- Consumes: `getHighlightSourceUrl`, `getHighlightSourceAddressPointer`, `getHighlightAttributions` from `applesauce-common/helpers` (verified v6 exports).
- Produces: `<HighlightCard event={NostrEvent(kind 9802)} authorProfile={any|null} />` — renders quote, source link, author byline. Used by Task 3's resolver.

- [ ] **Step 1: Write the failing test** — `src/lib/components/__tests__/HighlightCard.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));
function StubComponent() {}
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: StubComponent }));

import HighlightCard from '$lib/components/bookmarks/HighlightCard.svelte';

const PUBKEY = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

/** @param {string[][]} tags */
const highlight = (tags) => ({
  id: 'h'.repeat(64),
  kind: 9802,
  pubkey: PUBKEY,
  content: 'the highlighted passage',
  tags,
  created_at: 1_700_000_000,
  sig: ''
});

describe('HighlightCard', () => {
  it('renders the highlighted text as a quote', () => {
    render(HighlightCard, { props: { event: highlight([]) } });
    expect(screen.getByText(/the highlighted passage/)).toBeTruthy();
  });

  it('links to the source URL from the r tag', () => {
    const { container } = render(HighlightCard, {
      props: { event: highlight([['r', 'https://example.org/article']]) }
    });
    const link = container.querySelector('a[href="https://example.org/article"]');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('links to the nostr source for a-tag highlights', () => {
    const { container } = render(HighlightCard, {
      props: { event: highlight([['a', `30023:${PUBKEY}:my-article`]]) }
    });
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: PUBKEY, identifier: 'my-article' });
    expect(container.querySelector(`a[href*="${naddr.slice(0, 20)}"]`)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/lib/components/__tests__/HighlightCard.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/lib/components/bookmarks/HighlightCard.svelte` (styling mirrors `EventHighlightCard`'s featured-highlight block):

```svelte
<!--
  HighlightCard — compact card for a single kind-9802 highlight (issue #45).
  Used by FeedEntryCard for the Highlights category and for reposts of
  highlights. Tag reading goes through applesauce helpers only.
-->
<script>
  import { nip19 } from 'nostr-tools';
  import { getDisplayName } from 'applesauce-core/helpers';
  import {
    getHighlightSourceUrl,
    getHighlightSourceAddressPointer
  } from 'applesauce-common/helpers';
  import { resolve } from '$app/paths';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';

  /** @type {{ event: any, authorProfile?: any }} */
  let { event, authorProfile = null } = $props();

  const getInternalProfile = useUserProfile(() => (authorProfile ? null : event.pubkey));
  const profile = $derived(authorProfile ?? getInternalProfile());

  const sourceUrl = $derived(getHighlightSourceUrl(event));
  const sourceHref = $derived.by(() => {
    if (sourceUrl) return sourceUrl;
    const pointer = getHighlightSourceAddressPointer(event);
    if (!pointer) return null;
    try {
      return resolve(`/${nip19.naddrEncode(pointer)}`);
    } catch {
      return null;
    }
  });
  const sourceLabel = $derived(sourceUrl ? new URL(sourceUrl).hostname : null);
</script>

<div class="rounded-lg border border-base-300 bg-base-100 p-4 shadow-sm">
  <div class="border-l-3 border-warning bg-warning/5 py-1 pl-3">
    <p class="text-sm text-base-content/80 italic">&ldquo;{event.content}&rdquo;</p>
  </div>
  <div class="mt-2 flex items-center justify-between gap-2 text-xs text-base-content/50">
    <div class="flex items-center gap-1.5">
      <ProfileAvatar pubkey={event.pubkey} {profile} size="xs" linkToProfile fallbackType="robohash" />
      <span>{getDisplayName(profile) || event.pubkey.slice(0, 8) + '…'}</span>
      <span>·</span>
      <span>{formatRelativeTime(event.created_at)}</span>
    </div>
    {#if sourceHref}
      <a
        href={sourceHref}
        target={sourceUrl ? '_blank' : undefined}
        rel={sourceUrl ? 'noopener noreferrer' : undefined}
        class="link truncate link-primary"
      >
        {sourceLabel || sourceHref.slice(0, 40)}
      </a>
    {/if}
  </div>
</div>
```

- [ ] **Step 4: Run to verify pass** — `pnpm vitest run src/lib/components/__tests__/HighlightCard.test.js` → PASS. (If `ProfileAvatar` mock path mismatches, use the relative specifier the component uses.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/bookmarks/HighlightCard.svelte src/lib/components/__tests__/HighlightCard.test.js
git commit -m "feat(feed): compact single-highlight card on applesauce helpers

Refs edufeed/edufeed-app#45

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `FeedEntryCard` — shared category→card resolver

**Files:**
- Create: `src/lib/components/shared/FeedEntryCard.svelte`
- Test: `src/lib/components/__tests__/FeedEntryCard.test.js`

**Interfaces:**
- Consumes: `kindToFeedCategory` (Task 1), `HighlightCard` (Task 2), existing cards (`NoteCard`, `CalendarEventCard`, `AMBResourceCard`, `ArticleCard`, `PollCard`, `PageNoteItem`, `UrlCard`), `groupByUrl` from `$lib/helpers/urlGrouping.js`.
- Produces: `<FeedEntryCard event authorProfile activeUser fallback? />` rendering the kind-appropriate card for any single event; renders the `fallback` snippet (or nothing) for unknown categories. Used by Tasks 4 and 5.

- [ ] **Step 1: Write the failing test** — `src/lib/components/__tests__/FeedEntryCard.test.js` (stub every card; assert dispatch, incl. the safety net):

```js
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

const stub = (/** @type {string} */ id) => ({
  default: (/** @type {any} */ anchor) => {
    const el = document.createElement('div');
    el.setAttribute('data-stub', id);
    anchor.before?.(el);
  }
});
// Svelte 5 component stubs must be real components; use tiny fixtures instead:
vi.mock('$lib/components/notes/NoteCard.svelte', async () => ({
  default: (await import('./fixtures/StubMarker.svelte')).default
}));
// ...same pattern for CalendarEventCard, AMBResourceCard, ArticleCard,
// PollCard, PageNoteItem, UrlCard, HighlightCard — each mocked to
// StubMarker.svelte which renders <div data-stub-kind={kind}> from its
// `event`/`note`/... prop. See Step 2 fixture.

import FeedEntryCard from '$lib/components/shared/FeedEntryCard.svelte';

const ev = (/** @type {number} */ kind, /** @type {string[][]} */ tags = []) => ({
  id: 'e'.repeat(64), kind, pubkey: 'a'.repeat(64), content: 'x', tags, created_at: 1, sig: ''
});

describe('FeedEntryCard dispatch', () => {
  it.each([
    [1, 'notes'],
    [30023, 'articles'],
    [1068, 'polls'],
    [9802, 'highlights'],
    [1111, 'bookmarks']
  ])('renders a card for kind %i', (kind) => {
    const { container } = render(FeedEntryCard, { props: { event: ev(kind) } });
    expect(container.querySelector('[data-stub]')).toBeTruthy();
  });

  it('renders a UrlCard for a kind 39701 web bookmark (synthesized group)', () => {
    const { container } = render(FeedEntryCard, {
      props: { event: ev(39701, [['d', 'example.org/post'], ['title', 'A post']]) }
    });
    expect(container.querySelector('[data-stub]')).toBeTruthy();
  });

  it('renders NOTHING for an unknown kind (safety net)', () => {
    const { container } = render(FeedEntryCard, { props: { event: ev(31337) } });
    expect(container.querySelector('[data-stub]')).toBeFalsy();
    expect(container.textContent?.trim()).toBe('');
  });
});
```

Fixture `src/lib/components/__tests__/fixtures/StubMarker.svelte`:

```svelte
<div data-stub>stub</div>
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/lib/components/__tests__/FeedEntryCard.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/lib/components/shared/FeedEntryCard.svelte`:

```svelte
<!--
  FeedEntryCard — the ONE place mapping a feed event to its rich card
  (issue #45). Used by ProfileFeedView (incl. repost targets) and
  RichFeedEntry, so a category added here renders everywhere. Unknown
  categories render the fallback snippet or nothing — never a blank shell.
-->
<script>
  import { kindToFeedCategory } from '$lib/helpers/profile-feed.js';
  import { getCalendarEventMetadata } from '$lib/helpers/eventUtils.js';
  import { formatAMBResource } from '$lib/helpers/educational/index.js';
  import { getProfileLookupRelays } from '$lib/helpers/relay-helper.js';
  import { groupByUrl } from '$lib/helpers/urlGrouping.js';
  import NoteCard from '$lib/components/notes/NoteCard.svelte';
  import CalendarEventCard from '$lib/components/calendar/CalendarEventCard.svelte';
  import AMBResourceCard from '$lib/components/educational/AMBResourceCard.svelte';
  import ArticleCard from '$lib/components/article/ArticleCard.svelte';
  import PollCard from '$lib/components/polls/PollCard.svelte';
  import PageNoteItem from '$lib/components/bookmarks/PageNoteItem.svelte';
  import UrlCard from '$lib/components/bookmarks/UrlCard.svelte';
  import HighlightCard from '$lib/components/bookmarks/HighlightCard.svelte';

  /**
   * @type {{
   *   event: any,
   *   authorProfile?: any,
   *   authorProfiles?: Map<string, any>,
   *   activeUser?: any,
   *   fallback?: import('svelte').Snippet
   * }}
   */
  let {
    event,
    authorProfile = null,
    authorProfiles = new Map(),
    activeUser = null,
    fallback = undefined
  } = $props();

  const category = $derived(kindToFeedCategory(event.kind));
  // Single 39701 events reuse the URL-group card by grouping just themselves.
  const soloUrlGroup = $derived(
    category === 'bookmarks' && event.kind === 39701 ? (groupByUrl([event])[0] ?? null) : null
  );
</script>

{#if category === 'notes'}
  <NoteCard note={event} {authorProfile} {activeUser} extraRelays={getProfileLookupRelays()} />
{:else if category === 'calendar'}
  {@const calendarEvent = getCalendarEventMetadata(event)}
  {#if calendarEvent}
    <CalendarEventCard event={calendarEvent} compact={false} {authorProfile} />
  {:else}
    {@render fallback?.()}
  {/if}
{:else if category === 'resources'}
  {@const resource = formatAMBResource(event)}
  {#if resource}
    <AMBResourceCard {resource} {authorProfile} compact={false} />
  {:else}
    {@render fallback?.()}
  {/if}
{:else if category === 'articles'}
  <ArticleCard article={event} {authorProfile} compact={false} />
{:else if category === 'polls'}
  <PollCard {event} truncate={true} />
{:else if category === 'highlights'}
  <HighlightCard {event} {authorProfile} />
{:else if category === 'bookmarks' && event.kind === 1111}
  <PageNoteItem {event} {authorProfile} {activeUser} />
{:else if soloUrlGroup}
  <UrlCard group={soloUrlGroup} {authorProfiles} />
{:else}
  {@render fallback?.()}
{/if}
```

- [ ] **Step 4: Run to verify pass** — `pnpm vitest run src/lib/components/__tests__/FeedEntryCard.test.js` → PASS. Check `PageNoteItem`'s actual props (`event, authorProfile, activeUser, communityPubkey`) and adjust the call if it differs.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/shared/FeedEntryCard.svelte src/lib/components/__tests__/FeedEntryCard.test.js src/lib/components/__tests__/fixtures/StubMarker.svelte
git commit -m "feat(feed): shared category-to-card resolver with no-blank safety net

Refs edufeed/edufeed-app#45

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Rewire `ProfileFeedView` — predicate filtering, resolver rendering, new chips, scroll row

**Files:**
- Modify: `src/lib/components/profile/ProfileFeedView.svelte`
- Modify: `messages/en.json`, `messages/de.json`

**Interfaces:**
- Consumes: `entryVisible` (Task 1), `FeedEntryCard` (Task 3).
- Produces: the feed UI described in the spec. No exported API.

- [ ] **Step 1: i18n keys** — append to `messages/en.json` (via a JSON-preserving edit, e.g. python json load/dump as used in this repo):

```json
"profile_tab_highlights": "Highlights",
"profile_tab_shared": "Shared"
```

and `messages/de.json`:

```json
"profile_tab_highlights": "Highlights",
"profile_tab_shared": "Geteilt"
```

- [ ] **Step 2: Chips config** — in `ProfileFeedView.svelte` extend `FILTER_CHIPS` (icons already exported from `$lib/components/icons`; add `EditIcon` and `RepostIcon` to the existing icon import):

```js
const FILTER_CHIPS = [
  { id: 'notes', label: () => m.profile_tab_notes(), icon: ChatIcon },
  { id: 'calendar', label: () => m.profile_tab_calendar(), icon: CalendarIcon },
  { id: 'resources', label: () => m.profile_tab_resources(), icon: GraduationCapIcon },
  { id: 'articles', label: () => m.profile_tab_articles(), icon: BookIcon },
  { id: 'bookmarks', label: () => m.profile_tab_bookmarks(), icon: BookmarkIcon },
  { id: 'highlights', label: () => m.profile_tab_highlights(), icon: EditIcon },
  { id: 'shared', label: () => m.profile_tab_shared(), icon: RepostIcon },
  { id: 'polls', label: () => m.profile_tab_polls(), icon: PollIcon }
];
```

- [ ] **Step 3: Filtering swap** — in the `feedItems` `$derived.by`:
  1. Remove the import and call of `filterFeedItems`; start from `items` directly. Remove the `activeFilters` `$derived` (and the now-unused `effectiveActiveCategories` import if nothing else uses it).
  2. Keep the bookmark split, but route kind 9802 into BOTH buckets (groups + individual entry):

```js
const BOOKMARK_GROUP_KINDS = new Set([39701, 9802, 1111]);
const GROUP_ONLY_KINDS = new Set([39701, 1111]);
// inside feedItems:
const regular = [];
const bookmarkEvents = [];
for (const event of items) {
  if (BOOKMARK_GROUP_KINDS.has(event.kind)) bookmarkEvents.push(event);
  if (!GROUP_ONLY_KINDS.has(event.kind)) regular.push(event);
}
```

  3. After the repost merge (and in the no-repost path), replace the `activeFilters.has(entry.type)` filter with ONE final visibility pass applied to the complete entry list:

```js
const visible = merged.filter((entry) => entryVisible(entry, categorySelection));
visible.sort((a, b) => b.ts - a.ts);
return visible;
```

  (Apply the same `entryVisible` filter to `feedEntries` when `repostItems.length === 0`.)
  4. Safety net: right after `mergeRepostsIntoFeed`, drop repost-only entries whose type has no card:

```js
const RENDERABLE_TYPES = new Set([
  'notes', 'calendar', 'resources', 'articles', 'bookmarks',
  'highlights', 'polls', 'bookmark-url', 'bookmark-ref'
]);
const merged = mergeRepostsIntoFeed(feedEntries, repostItems, resolvedLookup)
  .filter((entry) => RENDERABLE_TYPES.has(entry.type));
```

- [ ] **Step 4: Rendering swap** — replace the per-type card branches inside the `feedEntry` snippet (keep the two group branches local):

```svelte
{#if entry.type === 'bookmark-url'}
  <UrlCard group={entry.data} {authorProfiles} />
{:else if entry.type === 'bookmark-ref'}
  <EventHighlightCard group={entry.data} {authorProfiles} />
{:else}
  <FeedEntryCard
    event={entry.data}
    authorProfile={authorProfiles.get(entry.data.pubkey) || null}
    {authorProfiles}
    {activeUser}
  />
{/if}
```

Remove the now-unused direct card imports (`NoteCard`, `CalendarEventCard`, `AMBResourceCard`, `ArticleCard`, `PollCard`) and add `FeedEntryCard`; keep `UrlCard`/`EventHighlightCard`.

- [ ] **Step 5: Scroll row** — change the chip container from wrapping to a single scrollable line:

```svelte
<div class="relative pb-4">
  <div class="pf-chip-row flex flex-nowrap gap-2 overflow-x-auto" data-testid="feed-filter-row">
    <!-- existing {#each FILTER_CHIPS ...} chips unchanged -->
  </div>
  <div class="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-base-100 to-transparent"></div>
</div>
```

with component styles:

```css
.pf-chip-row {
  scrollbar-width: none;
}
.pf-chip-row::-webkit-scrollbar {
  display: none;
}
```

- [ ] **Step 6: Verify** — `pnpm vitest run src/lib/__tests__/profile-feed.test.js src/lib/components/__tests__` → green; `pnpm run check` → 0 errors; `pnpm run lint` → baseline only.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/profile/ProfileFeedView.svelte messages/en.json messages/de.json
git commit -m "feat(feed): Highlights + Geteilt chips, dual-membership filtering, scrollable chip row

Refs edufeed/edufeed-app#45

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `RichFeedEntry` delegates to the resolver

**Files:**
- Modify: `src/lib/components/dashboard/RichFeedEntry.svelte`

**Interfaces:**
- Consumes: `FeedEntryCard` (Task 3) — same props, fallback snippet threaded through.

- [ ] **Step 1: Replace the branching** — `RichFeedEntry.svelte` becomes a thin wrapper (delete the card imports and the category branches):

```svelte
<!--
  RichFeedEntry — renders a feed event with its kind-specific rich card via
  the shared FeedEntryCard resolver. Kinds without a rich renderer fall back
  to the snippet passed by the parent (compact FeedCard in the dashboard feed).
-->
<script>
  import FeedEntryCard from '$lib/components/shared/FeedEntryCard.svelte';

  /**
   * @type {{
   *   event: any,
   *   authorProfile?: any,
   *   activeUser?: any,
   *   fallback?: import('svelte').Snippet
   * }}
   */
  let { event, authorProfile = null, activeUser = null, fallback } = $props();
</script>

<FeedEntryCard {event} {authorProfile} {activeUser} {fallback} />
```

- [ ] **Step 2: Verify** — `pnpm vitest run src/lib/components/__tests__` → green (fix any RichFeedEntry test mocks that referenced the old imports); `pnpm run check` → 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/dashboard/RichFeedEntry.svelte
git commit -m "refactor(feed): RichFeedEntry renders through the shared resolver

Refs edufeed/edufeed-app#45

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Full verification + browser smoke + issue close

**Files:** none new.

- [ ] **Step 1: Full sweep** — `pnpm vitest run src/lib/__tests__ src/lib/components/__tests__` → 0 failures (baseline is fully green as of 2026-07-14); `pnpm run check` → 0 errors; `pnpm run lint` → baseline only.

- [ ] **Step 2: Browser smoke** (use the `verify` skill conventions; start `pnpm run dev`, note the ACTUAL port from the log — stale worktree servers squat 5199+):
  - `/c/?view=feed` logged in: chip row scrolls horizontally on narrow viewport, all 8 chips reachable, edge fade visible.
  - Solo *Geteilt*: every visible entry has a share byline AND a content card (zero headless rows).
  - Solo *Lesezeichen*: URL/event-ref group cards only.
  - Solo *Highlights*: single highlight quotes render with source links.
  - Hide *Geteilt*: no share bylines anywhere in All.

- [ ] **Step 3: Push and close** — push the branch, comment on issue #45 with the commit range and smoke results; the final commit message body must contain `Fixes edufeed/edufeed-app#45` so the merge closes the issue.

---

## Self-Review Notes

- Spec coverage: category model (T1), predicate semantics (T1), resolver + both surfaces (T3–T5), highlight/1111/39701 repost cards (T2, T3), safety net (T3 fallback + T4 RENDERABLE_TYPES), chips + i18n + scroll row (T4), testing (each task) — no gaps.
- `filterFeedItems` deletion is intentional; its only consumer is rewired in T4 (T1 Step 4 notes the transient compile break, checked in T4).
- Type consistency: `entryVisible(entry, categorySelection)` matches the `CategorySelection` shape (`{solo, hidden}`) already in `ProfileFeedView`; `FeedEntryCard` prop names match at all three call sites.
