// @ts-nocheck
/** @vitest-environment jsdom */
// The /c mobile header in community mode: back arrow to the communities
// list, the community name opens the switcher drawer, a gear for admins and
// owners. In dashboard mode the logo still toggles the drawer.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const holders = vi.hoisted(() => ({
  user: { pubkey: 'a'.repeat(64) },
  desktop: false,
  pageParams: { pubkey: 'npub1x' },
  pageData: { pubkey: 'c'.repeat(64) }
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable({
      get params() {
        return holders.pageParams;
      },
      get data() {
        return holders.pageData;
      },
      url: new URL('http://localhost/c/npub1x')
    })
  };
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
vi.mock('$lib/components/shared/TermiLauncherButton.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/paraglide/messages', () => ({
  community_layout_title: () => 'Communities',
  community_layout_close_sidebar: () => 'Schließen',
  community_header_back_aria: () => 'Zurück',
  community_header_switch_aria: () => 'Community wechseln',
  community_header_settings_aria: () => 'Einstellungen'
}));

const { default: Harness } = await import('./__mocks__/MobileHeaderHarness.svelte');

beforeEach(() => {
  holders.pageParams = { pubkey: 'npub1x' };
  holders.pageData = { pubkey: 'c'.repeat(64) };
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

describe('/c mobile header in community mode', () => {
  it('back arrow links to the communities view', () => {
    const { getByTestId } = render(Harness, { title: 'Fortbildungsnetz' });
    expect(getByTestId('header-back').getAttribute('href')).toBe('/c/?view=communities');
  });

  it('center button shows the name and toggles the drawer', async () => {
    const { getByTestId, container } = render(Harness, { title: 'Fortbildungsnetz' });
    const sw = getByTestId('header-switch');
    expect(sw.textContent).toContain('Fortbildungsnetz');
    const toggle = container.querySelector('#community-drawer');
    expect(toggle.checked).toBe(false);
    await fireEvent.click(sw);
    expect(toggle.checked).toBe(true);
  });

  it('no gear without showSettings', () => {
    const { queryByTestId } = render(Harness, { title: 'X', showSettings: false });
    expect(queryByTestId('header-settings')).toBeNull();
  });

  it('gear links to settings when showSettings', () => {
    const { getByTestId } = render(Harness, {
      title: 'X',
      showSettings: true,
      settingsHref: '/c/npub1x?view=settings'
    });
    expect(getByTestId('header-settings').getAttribute('href')).toBe('/c/npub1x?view=settings');
  });

  it('dashboard mode keeps the logo drawer toggle', () => {
    holders.pageParams = {};
    holders.pageData = {};
    const { getByTestId, queryByTestId } = render(Harness, { title: 'Edufeed' });
    expect(getByTestId('header-drawer-toggle')).toBeTruthy();
    expect(queryByTestId('header-back')).toBeNull();
  });
});
