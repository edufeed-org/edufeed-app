/** @vitest-environment jsdom */
// Logged-out mobile menu: the help row sits next to the imprint so visitors
// without an account reach the guide too (logged-in users get it through
// AccountMenuSection). Hidden when HELP_URL=none.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
const { active$ } = await vi.hoisted(async () => {
  const { BehaviorSubject } = await import('rxjs');
  return { active$: new BehaviorSubject(/** @type {any} */ (null)) };
});

vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active$ } }));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: { openModal: vi.fn() } }));
vi.mock('$lib/loaders/calendar.js', () => ({ prefetchCalendarData: vi.fn() }));
vi.mock('$lib/services/inbox-service.svelte.js', () => ({ getTotalUnreadCount: () => 0 }));
vi.mock('$lib/services/dm-service.svelte.js', () => ({ getUnreadDmCount: () => 0 }));
vi.mock('../shared/AccountMenuSection.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ConnectionStatus.svelte', () => ({ default: () => ({}) }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));

const mockConfig = vi.hoisted(() => ({
  help: /** @type {{url: string | null}} */ ({ url: '/wiki/edufeed-erste-schritte' }),
  privacy: { enabled: true }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get help() {
      return mockConfig.help;
    },
    get privacy() {
      return mockConfig.privacy;
    }
  }
}));

import MobileNavMenu from '../shared/MobileNavMenu.svelte';

describe('MobileNavMenu logged-out help row', () => {
  beforeEach(() => {
    active$.next(null);
    mockConfig.help = { url: '/wiki/edufeed-erste-schritte' };
    mockConfig.privacy = { enabled: true };
  });

  it('links to the privacy policy and closes the menu on click', async () => {
    const onClose = vi.fn();
    const { findByTestId } = render(MobileNavMenu, { onClose });
    const link = await findByTestId('privacy-menu-item');
    expect(link.getAttribute('href')).toBe('/privacy');
    link.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits the privacy row when no policy is configured', async () => {
    mockConfig.privacy = { enabled: false };
    const { findByText, queryByTestId } = render(MobileNavMenu, { onClose: vi.fn() });
    await findByText(/Impressum|Imprint/);
    expect(queryByTestId('privacy-menu-item')).toBeNull();
  });

  it('links to the guide and closes the menu on click', async () => {
    const onClose = vi.fn();
    const { findByTestId } = render(MobileNavMenu, { onClose });
    const link = await findByTestId('help-menu-item');
    expect(link.getAttribute('href')).toBe('/wiki/edufeed-erste-schritte');
    link.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits the row when no guide is configured', async () => {
    mockConfig.help = { url: null };
    const { findByText, queryByTestId } = render(MobileNavMenu, { onClose: vi.fn() });
    await findByText(/Impressum|Imprint/);
    expect(queryByTestId('help-menu-item')).toBeNull();
  });
});
