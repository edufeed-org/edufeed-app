// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * The /c layout must mount its page exactly ONCE.
 *
 * It used to render `{@render children()}` in a desktop block AND a mobile
 * block and hide the inactive one with CSS. Hidden is not unmounted: every
 * page under /c ran twice — two community heroes, two click handlers, two
 * sidebars — so one Follow click toasted twice and published the kind 30000
 * follow set twice (seen 2026-09-30).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

const holders = vi.hoisted(() => ({ user: null, desktop: true, mounts: 0 }));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable({ params: {}, data: {}, url: new URL('http://localhost/c/') })
  };
});
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => holders.user
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { appName: 'Edufeed', appLogo: '' }
}));
vi.mock('$lib/components/community/layout/CommunitySidebar.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/shared/MobileNavMenu.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/components/shared/ImageWithFallback.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));

const { default: Layout } = await import('../../../routes/c/+layout.svelte');

/** A child page that counts how often it is mounted. */
const page = createRawSnippet(() => ({
  render: () => '<div data-testid="child-page">page</div>',
  setup: () => {
    holders.mounts++;
  }
}));

beforeEach(() => {
  holders.mounts = 0;
  holders.user = null;
  // MediaQuery reads window.matchMedia; jsdom has none.
  window.matchMedia = (query) => ({
    matches: query.includes('min-width') ? holders.desktop : !holders.desktop,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false
  });
});

describe('/c layout mounts its page once', () => {
  for (const desktop of [true, false]) {
    for (const loggedIn of [true, false]) {
      it(`${desktop ? 'desktop' : 'mobile'}, ${loggedIn ? 'logged in' : 'anonymous'}`, () => {
        holders.desktop = desktop;
        holders.user = loggedIn ? { pubkey: 'a'.repeat(64) } : null;

        const { getAllByTestId } = render(Layout, { props: { children: page } });

        expect(getAllByTestId('child-page')).toHaveLength(1);
        expect(holders.mounts).toBe(1);
      });
    }
  }

  it('shows the mobile header only on mobile', () => {
    holders.user = { pubkey: 'a'.repeat(64) };

    holders.desktop = true;
    const desktop = render(Layout, { props: { children: page } });
    expect(desktop.queryByTestId('mobile-community-header')).toBeNull();
    desktop.unmount();

    holders.desktop = false;
    const mobile = render(Layout, { props: { children: page } });
    expect(mobile.queryByTestId('mobile-community-header')).toBeTruthy();
  });
});
