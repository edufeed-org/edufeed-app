// @ts-nocheck
/**
 * AccountMenuSection — shared component used by Navbar profile dropdown
 * and MobileNavMenu auth section. Verifies grouping, conditional rendering
 * for multi-account state, and click behavior (callbacks, removeAccount).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { BehaviorSubject } from 'rxjs';
import AccountMenuSection from '../shared/AccountMenuSection.svelte';

// Active + accounts streams. Re-created in beforeEach so tests don't bleed.
const active$ = new BehaviorSubject(/** @type {any} */ (null));
const accounts$ = new BehaviorSubject(/** @type {any[]} */ ([]));

const mockManager = vi.hoisted(() => ({
  active$: null,
  accounts$: null,
  accounts: [],
  removeAccount: vi.fn()
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  manager: mockManager
}));

const mockModalStore = vi.hoisted(() => ({
  openModal: vi.fn(),
  closeModal: vi.fn(),
  activeModal: null
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: mockModalStore
}));

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => ({ name: 'Alice' })
}));

const mockPendingCount = vi.hoisted(() => ({ value: 0 }));
vi.mock('$lib/stores/membership-pending.svelte.js', () => ({
  useMembershipPendingCount: () => () => mockPendingCount.value
}));

const mockRuntimeConfig = vi.hoisted(() => ({
  membership: { adminPubkeys: /** @type {string[]} */ ([]) }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: mockRuntimeConfig
}));

vi.mock('applesauce-core/helpers', () => ({
  getDisplayName: (profile, fallback) => profile?.name || fallback
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (pubkey) => (pubkey ? `/p/${pubkey}` : '#')
}));

// Heavy avatar component — replace with stub.
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: () => ({}) }));

vi.mock('$app/paths', () => ({
  resolve: (path) => path
}));

vi.mock('$lib/paraglide/messages', () => ({
  common_profile: () => 'Profil',
  common_settings: () => 'Einstellungen',
  navbar_switch_account: () => 'Konto wechseln',
  navbar_imprint: () => 'Impressum',
  navbar_logout_current: () => 'Abmelden',
  navbar_logout_all: () => 'Alle Konten abmelden',
  navbar_logout_all_confirm: () => 'Sure?',
  admin_membership_title: () => 'Mitgliedschaftsanträge'
}));

const PUBKEY_A = 'a'.repeat(64);
const ACCOUNT_A = { id: 'acct-a', pubkey: PUBKEY_A };
const ACCOUNT_B = { id: 'acct-b', pubkey: 'b'.repeat(64) };

beforeEach(() => {
  // Reset shared subjects
  active$.next(ACCOUNT_A);
  accounts$.next([ACCOUNT_A]);
  mockManager.active$ = active$;
  mockManager.accounts$ = accounts$;
  mockManager.accounts = [ACCOUNT_A];
  mockManager.removeAccount.mockReset();
  mockModalStore.openModal.mockReset();
  mockPendingCount.value = 0;
  mockRuntimeConfig.membership = { adminPubkeys: [] };
});

describe('AccountMenuSection', () => {
  it('renders the active account display name in the identity header', async () => {
    const { findByText } = render(AccountMenuSection, { onClose: vi.fn() });
    expect(await findByText('Alice')).toBeTruthy();
  });

  it('renders all five action rows when only one account exists', async () => {
    const { findByText, queryByText } = render(AccountMenuSection, { onClose: vi.fn() });
    expect(await findByText('Profil')).toBeTruthy();
    expect(await findByText('Einstellungen')).toBeTruthy();
    expect(await findByText('Konto wechseln')).toBeTruthy();
    expect(await findByText('Impressum')).toBeTruthy();
    expect(await findByText('Abmelden')).toBeTruthy();
    expect(queryByText('Alle Konten abmelden')).toBeNull();
  });

  it('shows "Alle Konten abmelden" when more than one account exists', async () => {
    accounts$.next([ACCOUNT_A, ACCOUNT_B]);
    mockManager.accounts = [ACCOUNT_A, ACCOUNT_B];
    const { findByText } = render(AccountMenuSection, { onClose: vi.fn() });
    expect(await findByText('Alle Konten abmelden')).toBeTruthy();
  });

  it('shows the account-count badge only when accountCount > 1', async () => {
    accounts$.next([ACCOUNT_A, ACCOUNT_B]);
    mockManager.accounts = [ACCOUNT_A, ACCOUNT_B];
    const { findByText, container } = render(AccountMenuSection, { onClose: vi.fn() });
    await findByText('Konto wechseln');
    const badge = container.querySelector('[data-testid="account-count-badge"]');
    expect(badge).toBeTruthy();
    expect(badge?.textContent?.trim()).toBe('2');
  });

  it('omits the account-count badge with a single account', async () => {
    const { findByText, container } = render(AccountMenuSection, { onClose: vi.fn() });
    await findByText('Konto wechseln');
    expect(container.querySelector('[data-testid="account-count-badge"]')).toBeNull();
  });

  it('Profil link points at the active user profile route', async () => {
    const { findByText } = render(AccountMenuSection, { onClose: vi.fn() });
    const profilLink = /** @type {HTMLAnchorElement} */ (await findByText('Profil'));
    // findByText returns the inner text node's closest interactive element
    const href = profilLink.closest('a')?.getAttribute('href');
    expect(href).toBe(`/p/${PUBKEY_A}`);
  });

  it('opens the login modal when "Konto wechseln" is clicked', async () => {
    const onClose = vi.fn();
    const { findByText } = render(AccountMenuSection, { onClose });
    await fireEvent.click(await findByText('Konto wechseln'));
    expect(mockModalStore.openModal).toHaveBeenCalledWith('login');
    expect(onClose).toHaveBeenCalled();
  });

  it('removes the active account on "Abmelden" click and calls onClose', async () => {
    const onClose = vi.fn();
    const { findByText } = render(AccountMenuSection, { onClose });
    await fireEvent.click(await findByText('Abmelden'));
    expect(mockManager.removeAccount).toHaveBeenCalledWith(ACCOUNT_A.id);
    expect(onClose).toHaveBeenCalled();
  });

  describe('Membership applications row', () => {
    it('is hidden when the active account is not on the admin allowlist', async () => {
      mockRuntimeConfig.membership = { adminPubkeys: [] };
      const { queryByText } = render(AccountMenuSection, { onClose: vi.fn() });
      expect(queryByText('Mitgliedschaftsanträge')).toBeNull();
    });

    it('renders without a badge when admin and pending count is 0', async () => {
      mockRuntimeConfig.membership = { adminPubkeys: [PUBKEY_A] };
      mockPendingCount.value = 0;
      const { findByText, container } = render(AccountMenuSection, { onClose: vi.fn() });
      await findByText('Mitgliedschaftsanträge');
      expect(container.querySelector('[data-testid="membership-pending-badge"]')).toBeNull();
    });

    it('renders a badge with the count when admin and pending > 0', async () => {
      mockRuntimeConfig.membership = { adminPubkeys: [PUBKEY_A] };
      mockPendingCount.value = 3;
      const { findByText, container } = render(AccountMenuSection, { onClose: vi.fn() });
      await findByText('Mitgliedschaftsanträge');
      const badge = container.querySelector('[data-testid="membership-pending-badge"]');
      expect(badge).toBeTruthy();
      expect(badge?.textContent?.trim()).toBe('3');
    });
  });

  it('"Abmelden" row carries the text-error class', async () => {
    const { findByText } = render(AccountMenuSection, { onClose: vi.fn() });
    const button = await findByText('Abmelden');
    // The text-error class lives on the <button> itself.
    const btn = button.closest('button');
    expect(btn?.className).toMatch(/text-error/);
  });
});
