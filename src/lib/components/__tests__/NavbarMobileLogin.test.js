/** @vitest-environment jsdom */
// Logged-out phones: "Anmelden" is a visible button in the navbar row, not
// only a text link at the end of the hamburger menu (mobile UX round).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { flushSync } from 'svelte';

const { active$, openModal } = await vi.hoisted(async () => {
  const { BehaviorSubject } = await import('rxjs');
  return { active$: new BehaviorSubject(/** @type {any} */ (null)), openModal: vi.fn() };
});

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active$ } }));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: { openModal } }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { appName: 'Edufeed', appLogo: '' }
}));
vi.mock('$lib/loaders/calendar.js', () => ({ prefetchCalendarData: vi.fn() }));
vi.mock('$lib/services/inbox-service.svelte.js', () => ({ getTotalUnreadCount: () => 0 }));
vi.mock('$lib/services/dm-service.svelte.js', () => ({ getUnreadDmCount: () => 0 }));
vi.mock('$lib/concord/pending-invites.svelte.js', () => ({ getPendingInviteCount: () => 0 }));
vi.mock('$lib/helpers/lazy-component.svelte.js', () => ({
  lazyComponent: () => ({ loaded: null, load: () => {}, Component: null })
}));
vi.mock('../shared/ProfileAvatar.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('../shared/ImageWithFallback.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('../LanguageSwitcher.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('../shared/ConnectionStatus.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));

const { default: Navbar } = await import('../Navbar.svelte');

describe('Navbar mobile login button', () => {
  beforeEach(() => {
    active$.next(null);
    openModal.mockReset();
  });

  it('shows an Anmelden button in the mobile row that opens the login dialog', async () => {
    const { getByTestId } = render(Navbar);
    const button = getByTestId('navbar-mobile-login');
    expect(button.closest('.lg\\:hidden')).not.toBeNull();
    await fireEvent.click(button);
    expect(openModal).toHaveBeenCalledWith('login');
  });

  it('no Anmelden button when logged in', () => {
    const { queryByTestId } = render(Navbar);
    active$.next({ pubkey: 'a'.repeat(64) });
    flushSync();
    expect(queryByTestId('navbar-mobile-login')).toBeNull();
  });
});
