// @ts-nocheck
/** @vitest-environment jsdom */
// Issue "mobile: bottom nav bar hides content": the /c mobile layout bounded
// EVERY page to the viewport (h-full + min-h-0 flex-1) so chat/call views can
// size themselves. A page taller than the screen overflowed that box, and
// <main>'s dock padding sat at the box end instead of after the content, so
// the last 80px of long pages hid under the dock. The chain is now bounded
// only for pages that own their bottom edge (chat composer, channels, the DM
// thread); everything else flows and the padding lands after the content.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

const holders = vi.hoisted(() => ({
  user: { pubkey: 'a'.repeat(64) },
  url: 'http://localhost/c/inbox',
  params: {},
  data: {}
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable({
      get params() {
        return holders.params;
      },
      get data() {
        return holders.data;
      },
      get url() {
        return new URL(holders.url);
      }
    })
  };
});
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => holders.user }));
vi.mock('$lib/stores/viewport.svelte.js', () => ({ useIsDesktop: () => () => false }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { appName: 'Edufeed', appLogo: '' }
}));
vi.mock('$lib/components/community/layout/CommunitySidebar.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/shared/MobileMenuSheet.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/shared/ImageWithFallback.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/shared/TermiLauncherButton.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));

const { default: Layout } = await import('../../../routes/c/+layout.svelte');
const page = createRawSnippet(() => ({ render: () => '<div data-testid="child-page">page</div>' }));

/** @param {string} url @param {object} [route] */
function mount(url, route = { params: {}, data: {} }) {
  holders.url = url;
  holders.params = route.params;
  holders.data = route.data;
  const { getByTestId, unmount } = render(Layout, { props: { children: page } });
  const result = {
    shell: [...getByTestId('mobile-shell').classList],
    column: [...getByTestId('mobile-column').classList],
    slot: [...getByTestId('mobile-slot').classList]
  };
  unmount();
  return {
    shell: { contains: (c) => result.shell.includes(c) },
    column: { contains: (c) => result.column.includes(c) },
    slot: { contains: (c) => result.slot.includes(c) }
  };
}

const community = { params: { pubkey: 'npub1x' }, data: { pubkey: 'c'.repeat(64) } };

describe('/c mobile layout height chain', () => {
  beforeEach(() => {
    holders.user = { pubkey: 'a'.repeat(64) };
  });

  it('flows (no bounded chain) on the inbox, so <main> padding lands after the content', () => {
    const { shell, column, slot } = mount('http://localhost/c/inbox');
    expect(shell.contains('min-h-0')).toBe(false);
    expect(column.contains('h-full')).toBe(false);
    expect(column.contains('min-h-0')).toBe(false);
    expect(slot.contains('min-h-0')).toBe(false);
    expect(shell.contains('flex-1')).toBe(true);
  });

  it('the flowing slot is a block, not a flex column: a page box with mx-auto must take the container width', () => {
    // As a flex item with auto margins the page's `mx-auto max-w-3xl` box is
    // sized to its content: one no-wrap line (a truncated DM preview) pushed
    // it to 768px in a 640px viewport and the whole page scrolled sideways.
    const { slot } = mount('http://localhost/c/inbox');
    expect(slot.contains('flex')).toBe(false);
    expect(slot.contains('flex-col')).toBe(false);
    expect(slot.contains('flex-1')).toBe(true);
  });

  it('flows on a community content page (calendar)', () => {
    const { shell, column } = mount('http://localhost/c/npub1x?view=calendar', community);
    expect(shell.contains('min-h-0')).toBe(false);
    expect(column.contains('h-full')).toBe(false);
  });

  it('stays bounded where the page owns its bottom edge: community chat and channels', () => {
    for (const view of ['chat', 'channels']) {
      const { shell, column, slot } = mount(`http://localhost/c/npub1x?view=${view}`, community);
      expect(shell.contains('min-h-0')).toBe(true);
      expect(column.contains('h-full')).toBe(true);
      expect(column.contains('min-h-0')).toBe(true);
      expect(slot.contains('min-h-0')).toBe(true);
      expect(slot.contains('flex-1')).toBe(true);
      expect(slot.contains('flex')).toBe(true);
      expect(slot.contains('flex-col')).toBe(true);
    }
  });

  it('stays bounded on the DM pages (the open thread owns the bottom edge)', () => {
    const { shell, column } = mount('http://localhost/c/messages/abc');
    expect(shell.contains('min-h-0')).toBe(true);
    expect(column.contains('h-full')).toBe(true);
  });
});
