// @ts-nocheck
/**
 * MobileMenuSheet — the phone's account/navigation menu as a bottom sheet
 * (replaces the DaisyUI dropdown that stacked MobileNavMenu + AccountMenuSection
 * into a 20-row popover taller than the screen). Opened from the avatar in the
 * /c header and from the Navbar's mobile trigger.
 *
 * Order (laoc, 2026-11-04): identity → Profil/Einstellungen/QR tiles → inbox
 * things the dock hides behind chat composers (+ Kalender, which nothing else
 * on the phone links) → account plumbing → help/feedback → quiet rows
 * (language, connection, legal) → logout. Entdecken, Gruppen (dock has them)
 * and Schlüssel sichern (lives in Einstellungen) are deliberately absent.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { BehaviorSubject } from 'rxjs';

const active$ = new BehaviorSubject(/** @type {any} */ (null));
const accounts$ = new BehaviorSubject(/** @type {any[]} */ ([]));

const mockManager = vi.hoisted(() => ({
  active$: null,
  accounts$: null,
  accounts: [],
  removeAccount: vi.fn()
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: mockManager }));

const mockModalStore = vi.hoisted(() => ({ openModal: vi.fn(), closeModal: vi.fn() }));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: mockModalStore }));

vi.mock('$lib/stores/backup-flags.svelte.js', () => ({ isBackupDownloaded: () => true }));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => ({ name: 'Alice' })
}));
const mockPendingCount = vi.hoisted(() => ({ value: 0 }));
vi.mock('$lib/stores/membership-pending.svelte.js', () => ({
  useMembershipPendingCount: () => () => mockPendingCount.value
}));
const mockCounts = vi.hoisted(() => ({ inbox: 0, dm: 0 }));
vi.mock('$lib/services/inbox-service.svelte.js', () => ({
  getTotalUnreadCount: () => mockCounts.inbox
}));
vi.mock('$lib/services/dm-service.svelte.js', () => ({ getUnreadDmCount: () => mockCounts.dm }));
vi.mock('$lib/loaders/calendar.js', () => ({ prefetchCalendarData: vi.fn() }));

const mockRuntimeConfig = vi.hoisted(() => ({
  membership: { adminPubkeys: /** @type {string[]} */ ([]) },
  help: /** @type {{url: string | null}} */ ({ url: '/wiki/edufeed-erste-schritte' }),
  privacy: { enabled: true }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: mockRuntimeConfig }));

const mockLocale = vi.hoisted(() => ({ current: 'de', setLocale: vi.fn() }));
vi.mock('$lib/paraglide/runtime', () => ({
  getLocale: () => mockLocale.current,
  setLocale: mockLocale.setLocale,
  locales: ['en', 'de']
}));

vi.mock('applesauce-core/helpers', () => ({
  getDisplayName: (profile, fallback) => profile?.name || fallback
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (pubkey) => (pubkey ? `/p/${pubkey}` : '#')
}));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ConnectionStatus.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$app/paths', () => ({ resolve: (path) => path }));

vi.mock('$lib/paraglide/messages', () => ({
  aria_close_modal: () => 'Schließen',
  common_profile: () => 'Profil',
  common_settings: () => 'Einstellungen',
  common_login: () => 'Anmelden',
  navbar_qr_code: () => 'Mein QR-Code',
  navbar_menu: () => 'Navigationsmenü',
  mobile_menu_title: () => 'Menü',
  navbar_discover: () => 'Entdecken',
  navbar_communities: () => 'Communities',
  navbar_calendar: () => 'Kalender',
  navbar_switch_account: () => 'Konto wechseln',
  navbar_help: () => 'Hilfe',
  navbar_language: () => 'Sprache',
  navbar_imprint: () => 'Impressum',
  navbar_privacy: () => 'Datenschutz',
  navbar_logout_current: () => 'Abmelden',
  navbar_logout_all: () => 'Alle Konten abmelden',
  dashboard_nav_inbox: () => 'Posteingang',
  dashboard_nav_my_stuff: () => 'Meine Inhalte',
  dm_title: () => 'Nachrichten',
  report_issue_menu_item: () => 'Feedback & Fehler melden',
  admin_membership_title: () => 'Mitgliedschaftsanträge',
  auth_readonly_account_type: () => 'Nur lesen'
}));

const { default: MobileMenuSheet } = await import('../shared/MobileMenuSheet.svelte');

const PUBKEY_A = 'a'.repeat(64);
const ACCOUNT_A = { id: 'acct-a', pubkey: PUBKEY_A, type: 'extension' };
const ACCOUNT_B = { id: 'acct-b', pubkey: 'b'.repeat(64), type: 'extension' };

const props = (extra = {}) => ({ open: true, onClose: vi.fn(), ...extra });

beforeEach(() => {
  active$.next(ACCOUNT_A);
  accounts$.next([ACCOUNT_A]);
  mockManager.active$ = active$;
  mockManager.accounts$ = accounts$;
  mockManager.accounts = [ACCOUNT_A];
  mockManager.removeAccount.mockReset();
  mockModalStore.openModal.mockReset();
  mockPendingCount.value = 0;
  mockCounts.inbox = 0;
  mockCounts.dm = 0;
  mockRuntimeConfig.membership = { adminPubkeys: [] };
  mockRuntimeConfig.help = { url: '/wiki/edufeed-erste-schritte' };
  mockRuntimeConfig.privacy = { enabled: true };
  mockLocale.current = 'de';
  mockLocale.setLocale.mockReset();
  document.body.style.overflow = '';
});

describe('MobileMenuSheet', () => {
  it('renders nothing while closed', () => {
    const { queryByTestId } = render(MobileMenuSheet, props({ open: false }));
    expect(queryByTestId('mobile-menu-sheet')).toBeNull();
  });

  describe('logged in', () => {
    it('leads with the identity (name links to the profile) and the three quick tiles', async () => {
      const { findByTestId, getByTestId } = render(MobileMenuSheet, props());
      const identity = await findByTestId('sheet-identity');
      expect(identity.textContent).toContain('Alice');
      expect(identity.getAttribute('href')).toBe(`/p/${PUBKEY_A}`);
      expect(getByTestId('tile-profile').getAttribute('href')).toBe(`/p/${PUBKEY_A}`);
      expect(getByTestId('tile-settings').getAttribute('href')).toBe('/settings');
      expect(getByTestId('tile-qr')).toBeTruthy();
    });

    it('QR tile opens the own profile QR modal and closes the sheet', async () => {
      const onClose = vi.fn();
      const { findByTestId } = render(MobileMenuSheet, props({ onClose }));
      await fireEvent.click(await findByTestId('tile-qr'));
      expect(mockModalStore.openModal).toHaveBeenCalledWith('profileQr', {
        pubkey: PUBKEY_A,
        npub: expect.stringMatching(/^npub1/)
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('lists the inbox group the dock may be hiding, plus Kalender', async () => {
      mockCounts.inbox = 15;
      mockCounts.dm = 2;
      const { findByTestId, getByTestId } = render(MobileMenuSheet, props());
      const inbox = await findByTestId('menu-inbox');
      expect(inbox.getAttribute('href')).toBe('/c/inbox');
      expect(inbox.textContent).toContain('15');
      const messages = getByTestId('menu-messages');
      expect(messages.getAttribute('href')).toBe('/c/messages');
      expect(messages.textContent).toContain('2');
      expect(getByTestId('menu-my-stuff').getAttribute('href')).toBe('/c/?view=my-stuff');
      expect(getByTestId('menu-calendar').getAttribute('href')).toBe('/calendar');
    });

    it('omits what the dock and Einstellungen already own: Entdecken, Communities, Gruppen, Schlüssel sichern', async () => {
      active$.next({ ...ACCOUNT_A, type: 'nsec' });
      const { findByTestId, container, queryByTestId } = render(MobileMenuSheet, props());
      await findByTestId('menu-inbox');
      expect(container.querySelector('a[href="/discover"]')).toBeNull();
      expect(container.querySelector('a[href="/communities"]')).toBeNull();
      expect(container.querySelector('a[href="/c/groups"]')).toBeNull();
      expect(queryByTestId('backup-key-menu-item')).toBeNull();
    });

    it('shows Mitgliedschaftsanträge with its badge only for admins', async () => {
      const first = render(MobileMenuSheet, props());
      await first.findByTestId('menu-inbox');
      expect(first.queryByText('Mitgliedschaftsanträge')).toBeNull();
      first.unmount();

      mockRuntimeConfig.membership = { adminPubkeys: [PUBKEY_A] };
      mockPendingCount.value = 3;
      const second = render(MobileMenuSheet, props());
      const row = await second.findByText('Mitgliedschaftsanträge');
      expect(row.closest('a')?.getAttribute('href')).toBe('/admin/membership');
      expect(second.getByTestId('membership-pending-badge').textContent?.trim()).toBe('3');
    });

    it('Konto wechseln opens the login modal and shows the account count past one', async () => {
      accounts$.next([ACCOUNT_A, ACCOUNT_B]);
      mockManager.accounts = [ACCOUNT_A, ACCOUNT_B];
      const onClose = vi.fn();
      const { findByText, getByTestId } = render(MobileMenuSheet, props({ onClose }));
      const row = await findByText('Konto wechseln');
      expect(getByTestId('account-count-badge').textContent?.trim()).toBe('2');
      await fireEvent.click(row);
      expect(mockModalStore.openModal).toHaveBeenCalledWith('login');
      expect(onClose).toHaveBeenCalled();
    });

    it('help, feedback, imprint and privacy rows are present and close the sheet', async () => {
      const onClose = vi.fn();
      const { findByTestId, getByTestId } = render(MobileMenuSheet, props({ onClose }));
      expect((await findByTestId('help-menu-item')).getAttribute('href')).toBe(
        '/wiki/edufeed-erste-schritte'
      );
      await fireEvent.click(getByTestId('report-issue-menu-item'));
      expect(mockModalStore.openModal).toHaveBeenCalledWith('reportIssue');
      expect(getByTestId('imprint-menu-item').getAttribute('href')).toBe('/imprint');
      expect(getByTestId('privacy-menu-item').getAttribute('href')).toBe('/privacy');
      await fireEvent.click(getByTestId('privacy-menu-item'));
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('omits help and privacy rows when the deployment has none', async () => {
      mockRuntimeConfig.help = { url: null };
      mockRuntimeConfig.privacy = { enabled: false };
      const { findByTestId, queryByTestId } = render(MobileMenuSheet, props());
      await findByTestId('imprint-menu-item');
      expect(queryByTestId('help-menu-item')).toBeNull();
      expect(queryByTestId('privacy-menu-item')).toBeNull();
    });

    it('language is a segmented toggle that marks the current locale and switches on tap', async () => {
      const onClose = vi.fn();
      const { findByTestId, getByTestId } = render(MobileMenuSheet, props({ onClose }));
      const de = await findByTestId('language-de');
      const en = getByTestId('language-en');
      expect(de.getAttribute('aria-pressed')).toBe('true');
      expect(en.getAttribute('aria-pressed')).toBe('false');
      await fireEvent.click(en);
      expect(mockLocale.setLocale).toHaveBeenCalledWith('en');
      expect(onClose).toHaveBeenCalled();
      // Tapping the current locale changes nothing.
      await fireEvent.click(de);
      expect(mockLocale.setLocale).toHaveBeenCalledTimes(1);
    });

    it('Abmelden is last, red, and removes the active account', async () => {
      const onClose = vi.fn();
      const { findByText, queryByText } = render(MobileMenuSheet, props({ onClose }));
      const logout = await findByText('Abmelden');
      expect(logout.closest('button')?.className).toMatch(/text-error/);
      expect(queryByText('Alle Konten abmelden')).toBeNull();
      await fireEvent.click(logout);
      expect(mockManager.removeAccount).toHaveBeenCalledWith(ACCOUNT_A.id);
      expect(onClose).toHaveBeenCalled();
    });

    it('offers Alle Konten abmelden with several accounts, confirming through the modal', async () => {
      accounts$.next([ACCOUNT_A, ACCOUNT_B]);
      mockManager.accounts = [ACCOUNT_A, ACCOUNT_B];
      const { findByText } = render(MobileMenuSheet, props());
      await fireEvent.click(await findByText('Alle Konten abmelden'));
      expect(mockModalStore.openModal).toHaveBeenCalledWith(
        'logoutConfirm',
        { mode: 'all', count: 0, canDownload: false },
        expect.anything()
      );
      mockModalStore.openModal.mock.calls[0][2].onConfirm();
      expect(mockManager.removeAccount).toHaveBeenCalledTimes(2);
    });
  });

  describe('logged out', () => {
    beforeEach(() => {
      active$.next(null);
      accounts$.next([]);
      mockManager.accounts = [];
    });

    it('lists the public destinations and a login button, no account rows', async () => {
      const onClose = vi.fn();
      const { findByTestId, container, queryByTestId } = render(
        MobileMenuSheet,
        props({ onClose })
      );
      const login = await findByTestId('sheet-login');
      expect(container.querySelector('a[href="/discover"]')).not.toBeNull();
      expect(container.querySelector('a[href="/communities"]')).not.toBeNull();
      expect(container.querySelector('a[href="/calendar"]')).not.toBeNull();
      expect(queryByTestId('sheet-identity')).toBeNull();
      expect(queryByTestId('tile-settings')).toBeNull();
      expect(queryByTestId('menu-inbox')).toBeNull();
      expect(queryByTestId('help-menu-item')).not.toBeNull();
      expect(queryByTestId('imprint-menu-item')).not.toBeNull();
      expect(queryByTestId('language-en')).not.toBeNull();
      await fireEvent.click(login);
      expect(mockModalStore.openModal).toHaveBeenCalledWith('login');
      expect(onClose).toHaveBeenCalled();
    });
  });
});
