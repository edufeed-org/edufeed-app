// @ts-nocheck
/** @vitest-environment jsdom */
// The /c mobile header carries the Termi launcher (phones have no floating
// bubble any more). It renders only while TermiAssistant is mounted.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';

const holders = vi.hoisted(() => ({ user: { pubkey: 'a'.repeat(64) }, desktop: false }));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return { page: readable({ params: {}, data: {}, url: new URL('http://localhost/c/') }) };
});
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => holders.user }));
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
vi.mock('$lib/paraglide/messages', () => ({
  community_layout_title: () => 'Communities',
  community_layout_close_sidebar: () => 'Schließen',
  termi_launcher_aria: () => 'Termi öffnen'
}));

const { termiLauncher } = await import('$lib/stores/termi-launcher.svelte.js');
const { default: Layout } = await import('../../../routes/c/+layout.svelte');
const child = createRawSnippet(() => ({ render: () => '<div>page</div>' }));

beforeEach(() => {
  termiLauncher.available = true;
  termiLauncher.openCount = 0;
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

describe('/c mobile header Termi launcher', () => {
  it('renders the launcher inside the mobile header when Termi is available', () => {
    const { getByTestId } = render(Layout, { children: child });
    const header = getByTestId('mobile-community-header');
    expect(header.querySelector('[data-testid="termi-header-launcher"]')).not.toBeNull();
  });

  it('renders no launcher when Termi is unavailable', () => {
    termiLauncher.available = false;
    const { getByTestId } = render(Layout, { children: child });
    expect(
      getByTestId('mobile-community-header').querySelector('[data-testid="termi-header-launcher"]')
    ).toBeNull();
  });
});
