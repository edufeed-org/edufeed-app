# App-wide Broken-Image Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No image in the app ever renders as the browser's broken-image icon — every failed load ends at a local, unfailable placeholder.

**Architecture:** Enhance the existing `ImageWithFallback.svelte` with a type-aware chain (proxy → original → robohash-for-avatars-only → local placeholder) and an optional `fallback` snippet. Then migrate every raw `<img>` with a network-derived `src` that has no deliberate error handling to use it. Spec: `docs/superpowers/specs/2026-07-16-image-fallback-design.md`.

**Tech Stack:** Svelte 5 (runes), JavaScript + JSDoc, TailwindCSS 4 + DaisyUI 5, Vitest + @testing-library/svelte (jsdom).

## Global Constraints

- Execute in a **git worktree** (see `superpowers:using-git-worktrees`), rebased onto `dev` (EnterWorktree bases on `main` — rebase onto `dev` before starting). Copy `.env` from the main checkout.
- Svelte 5 runes only; plain JS with JSDoc type annotations (no TS).
- Style with DaisyUI semantic tokens (`bg-base-200`, `text-base-content/30`) — never hardcoded colors.
- Component tests live in `src/lib/components/__tests__/`, annotated `@vitest-environment jsdom`. Run with `pnpm test:component -- <filter>`.
- `pnpm test` may HMR-storm a running Vite dev server (paraglide compile) — fine in a worktree.
- lint-staged auto-formats on commit; commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Known-flaky under full parallel `pnpm test`: inbox/DM test files — if they fail, rerun in isolation before assuming a regression.

## Deviations from spec §3 (flagged at plan review)

1. **Sites with deliberate existing error handling are skipped** — they already never show a broken icon, and replacing their tailored behavior with a generic placeholder would be a UX regression: `LinkPreview` (hides thumb on error), `ResourceCover` (pdf-thumb → gradient cover), `ResourceFormWizard` image preview at line ~1991 (error state is form feedback), `ProfileHeader` banner (pattern backstop), `CommunityProfileHero` banner (hides), `ImageLibraryPickerModal`/`ImageLibraryDetailModal` (swap to local data-URI placeholder), `MediaLightbox` (opened from an already-loaded thumbnail; also needs `data-testid` passthrough).
2. **ProfileAvatar swap-in only for `ThreadCard`** (near drop-in). Other avatar sites keep their markup and use `ImageWithFallback` directly — `ProfileAvatar` brings its own wrapper div, size scale, self-loading, and hover card, which would change layout/behavior in filters, dropdowns, and pickers.
3. Sites that already have an initial-letter fallback pass it as the `fallback` snippet and set `robohash={false}` (matches ProfileAvatar `'initial'` semantics).

---

### Task 1: PhotoIcon + enhanced ImageWithFallback

**Files:**
- Create: `src/lib/components/icons/ui/PhotoIcon.svelte`
- Modify: `src/lib/components/icons/index.js`
- Modify: `src/lib/components/shared/ImageWithFallback.svelte`
- Test: `src/lib/components/__tests__/ImageWithFallback.test.js` (new)

**Interfaces:**
- Consumes: `getProxiedImageUrl(src, size)` from `$lib/helpers/image-proxy.js`; `PersonIcon`, `PeopleIcon`, `BadgeIcon` from the icons barrel.
- Produces: `ImageWithFallback` props — `src: string`, `alt: string`, `fallbackType?: 'avatar'|'event'|'community'|'banner'|'badge'|'generic'` (default `'generic'`), `robohash?: boolean` (default `fallbackType === 'avatar'`), `size?: string|{w,h}`, `class?: string`, `loading?: 'lazy'|'eager'`, `width?: number`, `height?: number`, `title?: string`, `onload?: (e) => void`, `fallback?: Snippet`. When every stage fails it renders the `fallback` snippet, or a default placeholder `<div data-testid="image-fallback-placeholder">`. All later tasks rely on exactly these prop names.

- [ ] **Step 1: Create the PhotoIcon**

`src/lib/components/icons/ui/PhotoIcon.svelte`:

```svelte
<!--
  PhotoIcon Component
  Image/photo icon — Bootstrap Icons "image" (https://icons.getbootstrap.com/icons/image/).
  Filled style; used as the generic broken-image placeholder glyph.
-->

<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Image';
</script>

<Icon {class_} {title} viewBox="0 0 16 16" fill="currentColor" stroke="none">
  <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0" />
  <path
    d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z"
  />
</Icon>
```

In `src/lib/components/icons/index.js`, add (alphabetically, next to `PersonIcon`):

```javascript
export { default as PhotoIcon } from './ui/PhotoIcon.svelte';
```

- [ ] **Step 2: Write the failing tests**

`src/lib/components/__tests__/ImageWithFallback.test.js`:

```javascript
/**
 * ImageWithFallback Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ImageWithFallback from '../shared/ImageWithFallback.svelte';

const SRC = 'https://img.example/pic.jpg';

describe('ImageWithFallback', () => {
  it('renders the original src when no size preset is given', () => {
    const { container } = render(ImageWithFallback, { props: { src: SRC, alt: 'pic' } });
    expect(container.querySelector('img')?.src).toBe(SRC);
  });

  it('starts at the proxied URL when a size preset is given', () => {
    const { container } = render(ImageWithFallback, {
      props: { src: SRC, alt: 'pic', size: 'avatar_md' }
    });
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/api/image?');
  });

  it('generic: falls back to the local placeholder after the original fails (no robohash)', async () => {
    const { container } = render(ImageWithFallback, { props: { src: SRC, alt: 'pic' } });
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    const placeholder = container.querySelector('[data-testid="image-fallback-placeholder"]');
    expect(placeholder).toBeTruthy();
    expect(placeholder?.getAttribute('aria-label')).toBe('pic');
  });

  it('avatar: tries robohash before the local placeholder', async () => {
    const { container } = render(ImageWithFallback, {
      props: { src: SRC, alt: 'pic', fallbackType: 'avatar' }
    });
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')?.src).toContain('robohash.org');
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="image-fallback-placeholder"]')).toBeTruthy();
  });

  it('avatar with robohash={false} skips robohash', async () => {
    const { container } = render(ImageWithFallback, {
      props: { src: SRC, alt: 'pic', fallbackType: 'avatar', robohash: false }
    });
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="image-fallback-placeholder"]')).toBeTruthy();
  });

  it('walks proxy → original → placeholder with a size preset (generic)', async () => {
    const { container } = render(ImageWithFallback, {
      props: { src: SRC, alt: 'pic', size: 'card' }
    });
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/api/image?');
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')?.src).toBe(SRC);
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('[data-testid="image-fallback-placeholder"]')).toBeTruthy();
  });

  it('renders the fallback snippet instead of the default placeholder', async () => {
    const fallback = createRawSnippet(() => ({
      render: () => '<span data-testid="custom-fallback">CF</span>'
    }));
    const { container } = render(ImageWithFallback, {
      props: { src: SRC, alt: 'pic', fallback }
    });
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('[data-testid="custom-fallback"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="image-fallback-placeholder"]')).toBeNull();
  });

  it('shows the placeholder immediately when src is empty', () => {
    const { container } = render(ImageWithFallback, { props: { src: '', alt: 'pic' } });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="image-fallback-placeholder"]')).toBeTruthy();
  });

  it('recovers from the placeholder when src changes', async () => {
    const { container, rerender } = render(ImageWithFallback, {
      props: { src: SRC, alt: 'pic' }
    });
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    await rerender({ src: 'https://img.example/other.jpg' });
    expect(container.querySelector('img')?.src).toBe('https://img.example/other.jpg');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test:component -- ImageWithFallback`
Expected: FAIL — placeholder/robohash-skip/snippet/empty-src tests fail against the current implementation (robohash for generic, no placeholder, no `fallback` prop).

- [ ] **Step 4: Implement the enhanced component**

Replace `src/lib/components/shared/ImageWithFallback.svelte` entirely with:

```svelte
<!--
  ImageWithFallback Component
  Displays an image with automatic fallback on load errors
  Supports image proxy for resizing and format optimization
  Fallback chain: proxy URL → original URL → robohash (avatars only) → local placeholder
  The terminal placeholder is local (icon on bg-base-200) and can never fail;
  pass a `fallback` snippet to render something richer (e.g. an initial letter).
-->

<script>
  import { getProxiedImageUrl } from '$lib/helpers/image-proxy.js';
  import { PersonIcon, PeopleIcon, BadgeIcon, PhotoIcon } from '$lib/components/icons';

  /**
   * @typedef {Object} Props
   * @property {string} src - Primary image source URL
   * @property {string} alt - Alt text for accessibility
   * @property {'avatar' | 'event' | 'community' | 'banner' | 'badge' | 'generic'} [fallbackType] - Drives the robohash stage and the placeholder icon
   * @property {boolean} [robohash] - Include the robohash stage; defaults to fallbackType === 'avatar'
   * @property {string | {w: number, h: number}} [size] - Proxy size preset or custom dimensions
   * @property {string} [class] - Additional CSS classes (applied to the img and the placeholder)
   * @property {'lazy' | 'eager'} [loading] - Loading attribute
   * @property {number} [width] - Intrinsic width hint, passed to the img
   * @property {number} [height] - Intrinsic height hint, passed to the img
   * @property {string} [title] - Title attribute, passed to the img
   * @property {(event: Event) => void} [onload] - Fires when the (possibly fallback) image has loaded; read natural dimensions off `event.currentTarget`
   * @property {import('svelte').Snippet} [fallback] - Rendered when every source stage fails
   */

  let {
    src,
    alt,
    fallbackType = 'generic',
    robohash = undefined,
    size = undefined,
    class: className = '',
    loading = /** @type {'lazy' | 'eager'} */ ('lazy'),
    width = undefined,
    height = undefined,
    title = undefined,
    onload = undefined,
    fallback = undefined
  } = $props();

  const useRobohash = $derived(robohash ?? fallbackType === 'avatar');

  // Track current image source (primary or fallback)
  let currentSrc = $state('');
  // All source stages failed → render the local placeholder
  let exhausted = $state(!src);

  // 0 = proxy, 1 = original, 2 = robohash
  let fallbackStage = 0;

  // Track initialized src to detect prop changes
  let initializedSrc = '';

  function handleError() {
    if (fallbackStage === 0) {
      // Proxy failed → try original URL
      fallbackStage = 1;
      currentSrc = src;
    } else if (fallbackStage === 1 && useRobohash) {
      // Compute robohash URL inline (no $derived) so this handler is safe
      // to fire after the owning $effect has been destroyed.
      fallbackStage = 2;
      currentSrc = `https://robohash.org/${src}`;
    } else {
      exhausted = true;
    }
  }

  // Initialize and reset when src or size changes
  $effect(() => {
    const proxied = getProxiedImageUrl(src, size);
    const effectiveSrc = proxied || src;
    // Only reset if the base src changed
    if (src !== initializedSrc) {
      // If proxy produced a different URL, start at stage 0
      fallbackStage = effectiveSrc !== src ? 0 : 1;
      currentSrc = effectiveSrc || '';
      exhausted = !src;
      initializedSrc = src;
    }
  });

  const PLACEHOLDER_ICONS = {
    avatar: PersonIcon,
    community: PeopleIcon,
    badge: BadgeIcon,
    event: PhotoIcon,
    banner: PhotoIcon,
    generic: PhotoIcon
  };
  const PlaceholderIcon = $derived(PLACEHOLDER_ICONS[fallbackType] ?? PhotoIcon);
</script>

{#if exhausted}
  {#if fallback}
    {@render fallback()}
  {:else}
    <div
      class="inline-flex items-center justify-center overflow-hidden bg-base-200 text-base-content/30 {className}"
      role="img"
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      data-testid="image-fallback-placeholder"
    >
      <PlaceholderIcon class_="h-1/2 max-h-8 w-1/2 max-w-8" title="" />
    </div>
  {/if}
{:else}
  <img
    src={currentSrc}
    {alt}
    {loading}
    {width}
    {height}
    {title}
    decoding="async"
    class={className}
    onerror={handleError}
    {onload}
  />
{/if}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:component -- ImageWithFallback`
Expected: PASS (all 9 tests).

- [ ] **Step 6: Run existing tests of ImageWithFallback consumers**

Run: `pnpm test:component -- HeroImage BadgeCard AMBResourceCard FeedCard`
Expected: PASS (these either mock ImageWithFallback or exercise the unchanged happy path).

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/icons/ui/PhotoIcon.svelte src/lib/components/icons/index.js src/lib/components/shared/ImageWithFallback.svelte src/lib/components/__tests__/ImageWithFallback.test.js
git commit -m "feat(shared): local unfailable placeholder + type-aware fallback chain in ImageWithFallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: ProfileAvatar initial-letter fallback for broken picture URLs

**Files:**
- Modify: `src/lib/components/shared/ProfileAvatar.svelte`
- Test: `src/lib/components/__tests__/ProfileAvatar.fallback.test.js` (new)

**Interfaces:**
- Consumes: `ImageWithFallback` props from Task 1 (`fallbackType`, `robohash`, `fallback` snippet).
- Produces: no API change — `ProfileAvatar` props (`pubkey`, `profile`, `size`, `fallbackType: 'initial'|'robohash'`, `linkToProfile`, `showHoverCard`, `class`, `loading`) stay identical. Task 5 (ThreadCard) relies on `profile` accepting a plain `{ picture, name }` object.

- [ ] **Step 1: Write the failing tests**

`src/lib/components/__tests__/ProfileAvatar.fallback.test.js`:

```javascript
/**
 * ProfileAvatar broken-picture fallback tests
 * Renders the REAL ImageWithFallback (not mocked) to exercise the chain.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ProfileAvatar from '../shared/ProfileAvatar.svelte';

vi.mock('applesauce-core/helpers', () => ({
  getProfilePicture: () => 'https://img.example/broken.jpg',
  getDisplayName: () => 'Silberengel'
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    profile: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
  }
}));

vi.mock('$lib/paraglide/messages', () => ({
  profile_avatar_alt: () => 'Avatar',
  profile_avatar_fallback: () => '?'
}));

vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (/** @type {string} */ pubkey) => (pubkey ? `/p/${pubkey}` : '#')
}));

vi.mock('../shared/HoverCard.svelte', async () => {
  const mock = await import('./__mocks__/HoverCardMock.svelte');
  return { default: mock.default };
});

vi.mock('../shared/ProfileHoverCardContent.svelte', () => ({
  default: function StubProfileHoverCardContent() {}
}));

const PROFILE = { picture: 'https://img.example/broken.jpg' };

describe('ProfileAvatar with a broken picture URL', () => {
  it("default ('initial') type: ends at the initial letter, never robohash", async () => {
    const { container } = render(ProfileAvatar, {
      props: { pubkey: 'abc123', profile: PROFILE }
    });
    // stage 0: proxied URL
    let img = container.querySelector('img');
    expect(img).not.toBeNull();
    await fireEvent.error(img);
    // stage 1: original URL
    img = container.querySelector('img');
    expect(img?.src).toBe('https://img.example/broken.jpg');
    await fireEvent.error(img);
    // exhausted → initial letter of the display name
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('S');
  });

  it("'robohash' type: tries robohash, then the initial letter", async () => {
    const { container } = render(ProfileAvatar, {
      props: { pubkey: 'abc123', profile: PROFILE, fallbackType: 'robohash' }
    });
    await fireEvent.error(container.querySelector('img')); // proxy → original
    await fireEvent.error(container.querySelector('img')); // original → robohash
    const img = container.querySelector('img');
    expect(img?.src).toContain('robohash.org');
    await fireEvent.error(img); // robohash → initial letter
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('S');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:component -- ProfileAvatar.fallback`
Expected: FAIL — after exhausting the chain the current component shows the default placeholder (or nothing), not the initial letter.

- [ ] **Step 3: Implement**

In `src/lib/components/shared/ProfileAvatar.svelte`:

Replace the `fallbackContent` / `showInitialFallback` / `showRobohashFallback` block (lines ~94-104) with:

```javascript
  // First letter of the display name — the unfailable terminal fallback
  let initialLetter = $derived(
    displayName?.trim()?.charAt(0)?.toUpperCase() || m.profile_avatar_fallback()
  );
```

Replace the `avatarContent` snippet with:

```svelte
{#snippet initialFallback()}
  <div
    class="flex h-full w-full items-center justify-center bg-primary text-sm font-semibold text-primary-content"
  >
    {initialLetter}
  </div>
{/snippet}

{#snippet avatarContent()}
  <div class="not-prose {sizeClasses[size]} rounded-full">
    {#if avatarUrl}
      <ImageWithFallback
        src={avatarUrl}
        alt={displayName || m.profile_avatar_alt()}
        fallbackType="avatar"
        robohash={fallbackType === 'robohash'}
        size={sizeToProxy[size]}
        {loading}
        class="h-full w-full rounded-full object-cover"
        fallback={initialFallback}
      />
    {:else if fallbackType === 'robohash' && pubkey}
      <ImageWithFallback
        src={`https://robohash.org/${pubkey}`}
        alt={displayName || m.profile_avatar_alt()}
        fallbackType="avatar"
        robohash={false}
        size={sizeToProxy[size]}
        {loading}
        class="h-full w-full rounded-full object-cover"
        fallback={initialFallback}
      />
    {:else}
      {@render initialFallback()}
    {/if}
  </div>
{/snippet}
```

(The second branch's `robohash={false}` prevents a robohash-of-robohash retry; a failed robohash now lands on the initial letter.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:component -- ProfileAvatar`
Expected: PASS — both new tests and the existing `ProfileAvatar.test.js` (which mocks ImageWithFallback and only checks link/hovercard behavior).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/shared/ProfileAvatar.svelte src/lib/components/__tests__/ProfileAvatar.fallback.test.js
git commit -m "feat(shared): ProfileAvatar falls back to initial letter when picture URL is broken

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: BadgeThumb broken-image fallback

**Files:**
- Modify: `src/lib/components/badges/BadgeThumb.svelte`
- Test: `src/lib/components/__tests__/BadgeThumb.test.js` (new)

**Interfaces:**
- Consumes: `ImageWithFallback` from Task 1.
- Produces: no API change (`thumb`, `image`, `alt`, `class` props unchanged).

- [ ] **Step 1: Write the failing tests**

`src/lib/components/__tests__/BadgeThumb.test.js`:

```javascript
/**
 * BadgeThumb fallback tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import BadgeThumb from '../badges/BadgeThumb.svelte';

describe('BadgeThumb', () => {
  it('renders the image when a src is set', () => {
    const { container } = render(BadgeThumb, {
      props: { thumb: 'https://img.example/badge.png', class: 'h-8 w-8' }
    });
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('shows the gradient placeholder when the image fails to load', async () => {
    const { container } = render(BadgeThumb, {
      props: { thumb: 'https://img.example/badge.png', class: 'h-8 w-8' }
    });
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[class*="bg-gradient"]')).toBeTruthy();
  });

  it('shows the gradient placeholder when no image is set', () => {
    const { container } = render(BadgeThumb, { props: {} });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[class*="bg-gradient"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:component -- BadgeThumb`
Expected: FAIL on "fails to load" — the raw `<img>` has no error handling.

- [ ] **Step 3: Implement**

Replace `src/lib/components/badges/BadgeThumb.svelte`'s script import block and markup so the existing gradient placeholder covers the broken-image case too:

```svelte
<script>
  import ImageWithFallback from '../shared/ImageWithFallback.svelte';

  /**
   * @typedef {Object} Props
   * @property {string} [thumb] - Preferred image (small)
   * @property {string} [image] - Fallback image (larger)
   * @property {string} [alt]
   * @property {string} [class] - Layout/border/shape classes applied to both image and placeholder
   */

  /** @type {Props} */
  let { thumb = '', image = '', alt = 'Badge', class: className = '' } = $props();

  const src = $derived(thumb || image);
</script>

{#snippet placeholder()}
  <div
    class="flex items-center justify-center bg-gradient-to-br from-primary/30 to-secondary/30 {className}"
    aria-label={alt}
  >
    <svg
      class="h-1/2 w-1/2 text-primary/60"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      stroke-width="2"
    >
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3l-5 3l1.523-9.11" />
    </svg>
  </div>
{/snippet}

{#if src}
  <ImageWithFallback
    {src}
    {alt}
    fallbackType="badge"
    class="object-cover {className}"
    fallback={placeholder}
  />
{:else}
  {@render placeholder()}
{/if}
```

(Keep the existing top-of-file HTML comment.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:component -- BadgeThumb BadgeCard BadgeHeaderRow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/badges/BadgeThumb.svelte src/lib/components/__tests__/BadgeThumb.test.js
git commit -m "feat(badges): BadgeThumb falls back to gradient placeholder on broken image

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Migrate community-avatar sites

**Files (modify):**
- `src/lib/components/AccountProfile.svelte`
- `src/lib/components/Sidebar.svelte`
- `src/lib/components/calendar/CalendarDropdown.svelte`
- `src/lib/components/community/layout/CommunitySidebar.svelte` (2 sites)
- `src/lib/components/community/layout/CompactCommunityHeader.svelte`
- `src/lib/components/CommunikeyHeader.svelte`
- `src/lib/components/shared/FeedCard.svelte`
- `src/lib/components/SignupCommunityPicker.svelte` (3 sites)
- `src/lib/components/educational/ResourceFormWizard.svelte` (community-picker avatar only, ~line 2963)

**Interfaces:**
- Consumes: `ImageWithFallback` from Task 1. Import in every file below as: `import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';`
- Produces: nothing consumed later.

General rules for every site in this task: keep the surrounding wrapper markup and any `{#if ...}` guard exactly as-is; only the `<img ...>` element is replaced. Where the old `<img>` had an `onerror` handler swapping to robohash, delete the handler (the component handles it).

- [ ] **Step 1: AccountProfile.svelte (~line 26)**

Old:

```svelte
<img
  alt=""
  src={getProfilePicture(getProfile()) || `https://robohash.org/${account.pubkey}`}
/>
```

New:

```svelte
<ImageWithFallback
  src={getProfilePicture(getProfile()) || `https://robohash.org/${account.pubkey}`}
  alt=""
  fallbackType="avatar"
  robohash={false}
  class="h-full w-full rounded-full object-cover"
/>
```

(`robohash={false}`: the src expression already defaults to robohash; don't retry robohash on robohash.)

- [ ] **Step 2: Sidebar.svelte (~line 63)**

Old:

```svelte
<img
  src={getProfilePicture(communityProfile) || `https://robohash.org/${communityPubKey}`}
  alt="Community"
  class="rounded-full object-cover"
/>
```

New:

```svelte
<ImageWithFallback
  src={getProfilePicture(communityProfile) || `https://robohash.org/${communityPubKey}`}
  alt="Community"
  fallbackType="community"
  class="h-full w-full rounded-full object-cover"
/>
```

- [ ] **Step 3: CalendarDropdown.svelte (~line 246)**

Same pattern as Sidebar: replace the `<img>` with `ImageWithFallback`, keeping the `src={getProfilePicture(communityProfile) || \`https://robohash.org/${communityPubkey}\`}` expression and `alt={getDisplayName(communityProfile)}`, adding `fallbackType="community"` and `class="h-full w-full rounded-full object-cover"`.

- [ ] **Step 4: CommunitySidebar.svelte (~lines 61 and 109)**

Both sites: replace the `<img ... onerror={...}>` with:

```svelte
<ImageWithFallback
  src={getProfilePicture(communityProfile) || `https://robohash.org/${communityPubKey}`}
  alt={getDisplayName(communityProfile)}
  fallbackType="community"
  class="h-full w-full rounded-full object-cover"
/>
```

Delete both old `onerror` robohash handlers.

- [ ] **Step 5: CompactCommunityHeader.svelte (~line 31)**

Old (including its onerror handler):

```svelte
<img
  src={avatarUrl || `https://robohash.org/${communityPubkey}`}
  alt={displayName}
  class="object-cover"
  onerror={(e) => { ... }}
/>
```

New:

```svelte
<ImageWithFallback
  src={avatarUrl || `https://robohash.org/${communityPubkey}`}
  alt={displayName}
  fallbackType="community"
  class="h-full w-full object-cover"
/>
```

- [ ] **Step 6: CommunikeyHeader.svelte (~line 79)**

Old:

```svelte
<img
  src={getProfilePicture(profile)}
  alt={m.communikey_header_profile_alt()}
  class="object-cover"
/>
```

New:

```svelte
<ImageWithFallback
  src={getProfilePicture(profile)}
  alt={m.communikey_header_profile_alt()}
  fallbackType="community"
  class="h-full w-full object-cover"
/>
```

(A missing picture now renders the community placeholder inside the hexagon mask instead of a broken img.)

- [ ] **Step 7: FeedCard.svelte (~line 249)**

Old:

```svelte
<img
  src={communityAvatar}
  alt={communityName}
  class="h-4 w-4 rounded-full object-cover"
/>
```

New:

```svelte
<ImageWithFallback
  src={communityAvatar}
  alt={communityName}
  fallbackType="community"
  class="h-4 w-4 rounded-full object-cover"
/>
```

- [ ] **Step 8: SignupCommunityPicker.svelte (3 sites, ~lines 120/169/206)**

All three are identical, inside `<div class="h-8 w-8 rounded-full bg-base-300">{#if profile?.picture}...{/if}</div>`.

Old: `<img src={profile.picture} alt="" loading="lazy" />`

New:

```svelte
<ImageWithFallback
  src={profile.picture}
  alt=""
  loading="lazy"
  fallbackType="community"
  class="h-full w-full rounded-full object-cover"
/>
```

- [ ] **Step 9: ResourceFormWizard.svelte (community picker avatar, ~line 2963 — NOT the image preview at ~line 1991)**

Old: `<img src={picture} alt="" class="h-8 w-8 rounded-full border border-base-300 object-cover" />`

New:

```svelte
<ImageWithFallback
  src={picture}
  alt=""
  fallbackType="community"
  class="h-8 w-8 rounded-full border border-base-300 object-cover"
/>
```

- [ ] **Step 10: Verify**

Run: `pnpm test:component -- FeedCard SignupCommunityPicker ResourceFormWizard CommunitySidebar`
Expected: PASS (missing filters are fine — run whatever matches).
Run: `pnpm run check`
Expected: no new errors.

- [ ] **Step 11: Commit**

```bash
git add -A src/lib/components
git commit -m "refactor: community avatar images use ImageWithFallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Migrate person-avatar sites

**Files (modify):**
- `src/lib/components/profile/ProfileHeader.svelte` (avatar only — leave the banner's pattern backstop alone)
- `src/lib/components/thread/ThreadCard.svelte`
- `src/lib/components/profile/ProfileRail.svelte`
- `src/lib/components/discover/AuthorSearchDropdown.svelte`
- `src/lib/components/profile/ImpersonationWarning.svelte`
- `src/lib/components/AccountManager.svelte`
- `src/lib/components/calendar/TopPublishersFilter.svelte`
- `src/lib/components/calendar/PeopleFilter.svelte`
- `src/lib/components/calendar/FeaturedAuthors.svelte`
- `src/lib/components/educational/CreatorInput.svelte`
- `src/lib/components/educational/AMBResourceView.svelte` (2 sites)

**Interfaces:**
- Consumes: `ImageWithFallback` (Task 1), `ProfileAvatar` (Task 2, ThreadCard only).
- Produces: nothing consumed later.

**Scoped-CSS gotcha for this task:** a raw `<img class="foo">` styled by a scoped rule like `.wrapper .foo { }` will NOT be styled once the img moves inside `ImageWithFallback` (child-component content doesn't get the scope hash). Where that applies, either replace the scoped class with Tailwind utility classes on the `class` prop (preferred) or convert the rule to `:global(...)`. Each step below says which.

- [ ] **Step 1: ProfileHeader.svelte avatar (~line 91)**

Old:

```svelte
<img
  src={profile?.picture || `https://robohash.org/${pubkey}`}
  alt={displayName}
  onerror={(e) => {
    const img = /** @type {HTMLImageElement} */ (e.currentTarget);
    if (!img.src.includes('robohash.org')) img.src = `https://robohash.org/${pubkey}`;
  }}
/>
```

New:

```svelte
<ImageWithFallback
  src={profile?.picture || `https://robohash.org/${pubkey}`}
  alt={displayName}
  fallbackType="avatar"
  robohash={false}
  class="block h-full w-full object-cover"
/>
```

Then DELETE the now-unmatched scoped rule (svelte-check would flag it as unused):

```css
.pf-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
```

(The `.pf-avatar` wrapper keeps its size/radius/overflow/gradient; the Tailwind classes on the component replace the deleted rule. Do NOT touch the banner `<img>` at ~line 82 — its `bannerError` → pattern-div backstop stays.)

- [ ] **Step 2: ThreadCard.svelte commenter avatars (~line 168-186) → ProfileAvatar**

Old:

```svelte
{#each displayCommenters as commenter (commenter.pubkey)}
  <a
    href={resolve(profileLink(commenter.pubkey))}
    class="avatar rounded-full border-2 border-base-100"
    title={commenter.name}
  >
    <div class="h-6 w-6 rounded-full">
      <img
        src={commenter.avatar}
        alt={commenter.name}
        loading="lazy"
        decoding="async"
      />
    </div>
  </a>
{/each}
```

New:

```svelte
{#each displayCommenters as commenter (commenter.pubkey)}
  <ProfileAvatar
    pubkey={commenter.pubkey}
    profile={{ picture: commenter.avatar, name: commenter.name }}
    size="xs"
    linkToProfile
    showHoverCard={false}
    class="rounded-full border-2 border-base-100"
  />
{/each}
```

Add `import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';` and remove the now-unused `resolve`/`profileLink` imports ONLY if nothing else in the file uses them (check first).

- [ ] **Step 3: ProfileRail.svelte mini-community icons (~line 155)**

Old:

```svelte
{#if communityPicture(communityPubkey)}
  <img class="ic" src={communityPicture(communityPubkey)} alt="" />
{:else}
  <span class="ic fallback">{communityName(communityPubkey)[0]?.toUpperCase()}</span>
{/if}
```

New (snippet declared inside the `{#each}` body, above the `{#if}`, so it captures `communityPubkey`):

```svelte
{#snippet icFallback()}
  <span class="ic fallback">{communityName(communityPubkey)[0]?.toUpperCase()}</span>
{/snippet}
{#if communityPicture(communityPubkey)}
  <ImageWithFallback
    src={communityPicture(communityPubkey)}
    alt=""
    fallbackType="community"
    robohash={false}
    class="h-[34px] w-[34px] shrink-0 rounded-[10px] object-cover"
    fallback={icFallback}
  />
{:else}
  {@render icFallback()}
{/if}
```

Leave the scoped `.pf-mini-comm .ic` CSS untouched — the fallback span still gets the scope hash; the img is styled by the Tailwind classes (34px / radius 10px mirror the `.ic` rule).

- [ ] **Step 4: AuthorSearchDropdown.svelte (~line 107)**

Old:

```svelte
{#if match.picture}
  <img
    src={match.picture}
    alt=""
    class="h-8 w-8 rounded-full object-cover"
    loading="lazy"
  />
{:else}
  <div
    class="flex h-8 w-8 items-center justify-center rounded-full bg-neutral text-sm text-neutral-content"
  >
    {(match.display_name || match.name || '?')[0]?.toUpperCase()}
  </div>
{/if}
```

New (snippet inside the `{#each}` body, capturing `match`):

```svelte
{#snippet authorInitial()}
  <div
    class="flex h-8 w-8 items-center justify-center rounded-full bg-neutral text-sm text-neutral-content"
  >
    {(match.display_name || match.name || '?')[0]?.toUpperCase()}
  </div>
{/snippet}
{#if match.picture}
  <ImageWithFallback
    src={match.picture}
    alt=""
    loading="lazy"
    fallbackType="avatar"
    robohash={false}
    class="h-8 w-8 rounded-full object-cover"
    fallback={authorInitial}
  />
{:else}
  {@render authorInitial()}
{/if}
```

- [ ] **Step 5: ImpersonationWarning.svelte (~line 116)**

Old:

```svelte
{#if match.picture}
  <img class="mav" src={match.picture} alt="" />
{:else}
  <span class="mav fallback">{match.name[0]?.toUpperCase()}</span>
{/if}
```

New:

```svelte
{#snippet mavFallback()}
  <span class="mav fallback">{match.name[0]?.toUpperCase()}</span>
{/snippet}
{#if match.picture}
  <ImageWithFallback
    src={match.picture}
    alt=""
    fallbackType="avatar"
    robohash={false}
    class="h-8 w-8 shrink-0 rounded-full object-cover"
    fallback={mavFallback}
  />
{:else}
  {@render mavFallback()}
{/if}
```

(Tailwind classes mirror the scoped `.mav` rule: 32px, round, shrink-0. Leave the `.mav` CSS for the fallback span.)

- [ ] **Step 6: AccountManager.svelte (~line 127)**

Old:

```svelte
<img
  src={'https://robohash.org/' + account.pubkey + '.png'}
  alt="Account avatar"
  class="h-24 w-24 rounded-full"
/>
```

New:

```svelte
<ImageWithFallback
  src={'https://robohash.org/' + account.pubkey + '.png'}
  alt="Account avatar"
  fallbackType="avatar"
  robohash={false}
  class="h-24 w-24 rounded-full"
/>
```

- [ ] **Step 7: TopPublishersFilter.svelte (~line 62)**

Old: `<img src={picture} alt="" class="h-4 w-4 rounded-full object-cover" />`

New:

```svelte
<ImageWithFallback
  src={picture}
  alt=""
  fallbackType="avatar"
  class="h-4 w-4 rounded-full object-cover"
/>
```

- [ ] **Step 8: PeopleFilter.svelte (~line 311) and FeaturedAuthors.svelte (~line 53)**

Both old: `<img src={avatarUrl(pubkey)} alt="" />` inside a DaisyUI `.avatar > div` wrapper.

Both new:

```svelte
<ImageWithFallback
  src={avatarUrl(pubkey)}
  alt=""
  fallbackType="avatar"
  class="h-full w-full rounded-full object-cover"
/>
```

- [ ] **Step 9: CreatorInput.svelte (~line 262)**

Old (inside `{#if creator.pubkey}` → `{@const getProfile = useUserProfile(creator.pubkey)}`):

```svelte
{#if getProfile() && getProfilePicture(getProfile())}
  <img
    src={getProfilePicture(getProfile())}
    alt={creator.name}
    class="h-full w-full object-cover"
  />
{:else if creator.type === 'Organization'}
  <span class="text-lg">🏢</span>
{:else}
  <span class="text-lg">{creator.name[0]?.toUpperCase() || '?'}</span>
{/if}
```

New — add a parameterized snippet at the top level of the component markup:

```svelte
{#snippet creatorFallback(/** @type {any} */ creator)}
  {#if creator.type === 'Organization'}
    <span class="text-lg">🏢</span>
  {:else}
    <span class="text-lg">{creator.name[0]?.toUpperCase() || '?'}</span>
  {/if}
{/snippet}
```

and replace the block with:

```svelte
{#if getProfile() && getProfilePicture(getProfile())}
  <ImageWithFallback
    src={getProfilePicture(getProfile())}
    alt={creator.name}
    fallbackType="avatar"
    robohash={false}
    class="h-full w-full object-cover"
  >
    {#snippet fallback()}
      {@render creatorFallback(creator)}
    {/snippet}
  </ImageWithFallback>
{:else}
  {@render creatorFallback(creator)}
{/if}
```

Also replace the equivalent org/initial spans in the `{:else if creator.type === 'Organization'} / {:else}` branches of the OUTER `{#if creator.pubkey}` block with `{@render creatorFallback(creator)}` if their markup is identical (check first; if the markup differs, leave them).

- [ ] **Step 10: AMBResourceView.svelte (2 sites, ~lines 790 and 829)**

First convert the scoped rule `.ed-contrib .av` to `.ed-contrib :global(.av)` (keep declarations identical) so the class keeps working from inside the child component.

Site 1 (creator entries, ~line 790). Old:

```svelte
{#if picture}
  <img class="av" src={picture} alt={m.amb_resource_creator_alt()} />
{:else}
  {@render initialAvatar(displayName, entry.type)}
{/if}
```

New:

```svelte
{#if picture}
  <ImageWithFallback
    class="av"
    src={picture}
    alt={m.amb_resource_creator_alt()}
    fallbackType="avatar"
    robohash={false}
  >
    {#snippet fallback()}
      {@render initialAvatar(displayName, entry.type)}
    {/snippet}
  </ImageWithFallback>
{:else}
  {@render initialAvatar(displayName, entry.type)}
{/if}
```

Site 2 (indexed-by publisher, ~line 829). Old:

```svelte
{#if publisherPicture}
  <img class="av" src={publisherPicture} alt={publisherName} />
{:else}
  <div class="av av-fallback" aria-hidden="true">
    {(publisherName?.trim()?.charAt(0) || '?').toUpperCase()}
  </div>
{/if}
```

New:

```svelte
{#snippet publisherInitial()}
  <div class="av av-fallback" aria-hidden="true">
    {(publisherName?.trim()?.charAt(0) || '?').toUpperCase()}
  </div>
{/snippet}
{#if publisherPicture}
  <ImageWithFallback
    class="av"
    src={publisherPicture}
    alt={publisherName}
    fallbackType="avatar"
    robohash={false}
    fallback={publisherInitial}
  />
{:else}
  {@render publisherInitial()}
{/if}
```

(The snippets are declared in the parent, so `.av`/`.av-fallback` inside them still get the scope hash; the `:global(.av)` conversion covers the component's inner `<img>`. If svelte-check flags other `.av`-referencing scoped rules as no-longer-matching or unused, convert those to `:global(...)` the same way.)

- [ ] **Step 11: Verify**

Run: `pnpm test:component -- AMBResourceView CreatorInput ThreadCard ProfileRail PeopleFilter`
Expected: PASS (run whatever matches; investigate any failure — likely a selector that expected a raw `img`).
Run: `pnpm run check`
Expected: no new errors, no unused-CSS-selector warnings in the touched files.

- [ ] **Step 12: Commit**

```bash
git add -A src/lib/components
git commit -m "refactor: person avatar images use ImageWithFallback/ProfileAvatar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Migrate content-image sites

**Files (modify):**
- `src/lib/components/shared/NostrContentRenderer.svelte` (3 sites)
- `src/lib/components/shared/EmojiPicker.svelte`
- `src/lib/components/reactions/ReactionButton.svelte`
- `src/lib/components/reactions/ReactionReactorsList.svelte`
- `src/lib/components/dashboard/DashboardLists.svelte`
- `src/lib/components/shared/NostrPreviews/CalendarPreview.svelte`
- `src/lib/components/shared/NostrPreviews/CalendarEventPreview.svelte`
- `src/lib/components/landing/LandingHero.svelte`
- `src/routes/discover/+page.svelte` (hero image)
- `src/lib/components/educational/EncodingPreview.svelte`

**Interfaces:**
- Consumes: `ImageWithFallback` from Task 1 (notably `size`, `width`, `height`, `title` passthrough).
- Produces: nothing consumed later.

Import in each file: `import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';`

- [ ] **Step 1: NostrContentRenderer.svelte (3 sites)**

Emoji (~line 108). Old:

```svelte
<img
  src={getProxiedImageUrl(node.url, 'emoji') || node.url}
  alt=":{node.code}:"
  title=":{node.code}:"
  class="inline h-5 w-5 align-text-bottom"
/>
```

New:

```svelte
<ImageWithFallback
  src={node.url}
  alt=":{node.code}:"
  title=":{node.code}:"
  size="emoji"
  fallbackType="generic"
  class="inline h-5 w-5 align-text-bottom"
/>
```

Inline content image (~line 128). Old:

```svelte
<img
  src={getProxiedImageUrl(node.href, 'content') || node.href}
  alt={meta?.alt || ''}
  loading="lazy"
  width={dims?.width}
  height={dims?.height}
  class="block h-auto max-h-[480px] w-auto max-w-full rounded-xl"
/>
```

New:

```svelte
<ImageWithFallback
  src={node.href}
  alt={meta?.alt || ''}
  loading="lazy"
  width={dims?.width}
  height={dims?.height}
  size="content"
  fallbackType="generic"
  class="block h-auto max-h-[480px] w-auto max-w-full rounded-xl"
/>
```

Gallery (~line 182). Old:

```svelte
<img
  src={getProxiedImageUrl(link, 'content') || link}
  alt={imetaFor(link)?.alt || ''}
  loading="lazy"
  class="h-full w-full object-cover"
/>
```

New:

```svelte
<ImageWithFallback
  src={link}
  alt={imetaFor(link)?.alt || ''}
  loading="lazy"
  size="content"
  fallbackType="generic"
  class="h-full w-full object-cover"
/>
```

Remove the `getProxiedImageUrl` import if nothing else in the file uses it.

- [ ] **Step 2: Emoji images (4 sites)**

`EmojiPicker.svelte` ~line 727. Old: `<img src={emoji.url} alt=":{emoji.shortcode}:" class="inline h-6 w-6 object-contain" loading="lazy" />`
New: `<ImageWithFallback src={emoji.url} alt=":{emoji.shortcode}:" loading="lazy" fallbackType="generic" class="inline h-6 w-6 object-contain" />`

`ReactionButton.svelte` ~line 101. Old: `<img src={emojiUrl} alt={emoji} title={emoji} class="inline h-4 w-4 object-contain" />`
New: `<ImageWithFallback src={emojiUrl} alt={emoji} title={emoji} fallbackType="generic" class="inline h-4 w-4 object-contain" />`

`ReactionReactorsList.svelte` ~line 39. Old: `<img src={emojiUrl} alt={emoji} class="inline h-5 w-5 object-contain" />`
New: `<ImageWithFallback src={emojiUrl} alt={emoji} fallbackType="generic" class="inline h-5 w-5 object-contain" />`

`DashboardLists.svelte` ~line 375. Old: `<img src={emoji.url} alt={emoji.shortcode} class="h-6 w-6 object-contain" />`
New: `<ImageWithFallback src={emoji.url} alt={emoji.shortcode} fallbackType="generic" class="h-6 w-6 object-contain" />`

- [ ] **Step 3: Nostr previews (2 sites)**

`NostrPreviews/CalendarPreview.svelte` ~line 79. Old: `<img src={calendar.image} alt={calendar.name} class="h-12 w-12 rounded-lg object-cover" />`
New: `<ImageWithFallback src={calendar.image} alt={calendar.name} fallbackType="event" class="h-12 w-12 rounded-lg object-cover" />`

`NostrPreviews/CalendarEventPreview.svelte` ~line 117. Old: `<img src={event.image} alt={event.title} class="h-16 w-16 flex-shrink-0 rounded-lg object-cover" />`
New: `<ImageWithFallback src={event.image} alt={event.title} fallbackType="event" class="h-16 w-16 flex-shrink-0 rounded-lg object-cover" />`

- [ ] **Step 4: Hero images (2 sites)**

`LandingHero.svelte` ~line 28. Old:

```svelte
<img
  src={getProxiedImageUrl(runtimeConfig.ui.landingHeroImage, 'hero') ||
    runtimeConfig.ui.landingHeroImage}
  alt=""
  class="absolute inset-0 h-full w-full object-cover"
/>
```

New:

```svelte
<ImageWithFallback
  src={runtimeConfig.ui.landingHeroImage}
  alt=""
  size="hero"
  loading="eager"
  fallbackType="banner"
  class="absolute inset-0 h-full w-full object-cover"
/>
```

`src/routes/discover/+page.svelte` ~line 1483: same transformation with `runtimeConfig.ui.discoverHeroImage`.

In both files remove the `getProxiedImageUrl` import ONLY if nothing else in the file uses it (discover/+page.svelte likely uses it elsewhere — check).

- [ ] **Step 5: EncodingPreview.svelte (~line 87)**

Old:

```svelte
<img
  src={embedSrc}
  alt={name}
  loading="lazy"
  class="block max-h-[80vh] w-full object-contain"
/>
```

New:

```svelte
<ImageWithFallback
  src={embedSrc}
  alt={name}
  loading="lazy"
  fallbackType="generic"
  class="block max-h-[80vh] w-full object-contain"
/>
```

- [ ] **Step 6: Verify**

Run: `pnpm test:component -- EncodingPreview NostrContentRenderer EmojiPicker ReactionButton DashboardLists`
Expected: PASS (run whatever matches).
Run: `pnpm run check`
Expected: no new errors (unused-import warnings mean Step 1/4 import cleanup was missed).

- [ ] **Step 7: Commit**

```bash
git add -A src/lib/components src/routes/discover
git commit -m "refactor: content images (emoji, previews, heroes, inline) use ImageWithFallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: PASS. Known-flaky inbox/DM files that fail under full parallel run must be rerun in isolation (`pnpm test:component -- <file>`) before treating as regression.

- [ ] **Step 2: Type check + lint**

Run: `pnpm run check && pnpm run lint`
Expected: no new errors vs the branch base (run once on the base commit if unsure of pre-existing noise).

- [ ] **Step 3: Visual spot-check in the real app**

Start `pnpm run dev` (verify which server answers the port — stale worktree dev servers squat 5199+). In the browser:

1. Feed/notes page: find or force a broken avatar (e.g. block `robohash.org` and the image host via DevTools request blocking) → the card must show an initial-letter or person-icon placeholder, never the broken-image icon.
2. A profile page with a broken picture URL → initial letter in the header avatar.
3. A badge with a broken image URL (DevTools-block the badge image host) → gradient badge placeholder.
4. Discover page resource covers with a blocked image host → photo-icon placeholder, layout unshifted.

Screenshot the states (scratchpad dir, not the repo) — test all visual states, not just the default render.

- [ ] **Step 4: Final commit (if fixes were needed) and wrap-up**

Use superpowers:finishing-a-development-branch to decide merge/PR.
