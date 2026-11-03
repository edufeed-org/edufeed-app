// @ts-nocheck
/**
 * DashboardCommunitiesPhone — the phone "Communities" tab: a Finden button,
 * one row per joined community ordered by newest activity, "neu" badges for
 * activity newer than this device's last visit, rows landing in the section
 * the row-target rule picks, then the create card.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

const state = vi.hoisted(() => ({
  joined: /** @type {string[]} */ ([]),
  status: 'ready',
  perCommunity: new Map(),
  isLoading: false,
  lastView: /** @type {Record<string, {view: string, at: number} | null>} */ ({}),
  discoverTypes: ['events', 'communities'],
  openModal: vi.fn(),
  retry: vi.fn()
}));

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  hexToNpub: (/** @type {string} */ hex) => `npub-${hex.slice(0, 1)}`
}));
vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useJoinedCommunitiesState: () => ({
    list: () => state.joined,
    status: () => state.status,
    retry: () => state.retry()
  })
}));
vi.mock('$lib/stores/joined-community-items.svelte.js', () => ({
  useJoinedCommunityItems: () => () => ({
    items: [],
    perCommunity: state.perCommunity,
    isLoading: state.isLoading
  })
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () =>
    new Map([
      [A, { name: 'Alpha', about: 'Fachschaft Mathe' }],
      [B, { name: 'Beta' }],
      [C, { display_name: 'Gamma', about: 'Nur Beschreibung' }]
    ])
}));
vi.mock('$lib/stores/community-last-view.js', () => ({
  readCommunityView: (/** @type {string} */ pk) => state.lastView[pk] ?? null
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: (_kind, _pk) => ({
      subscribe: (/** @type {(e: any) => void} */ cb) => {
        cb({ kind: 10222, pubkey: _pk, tags: [], content: '' });
        return { unsubscribe: () => {} };
      }
    })
  }
}));
vi.mock('$lib/helpers/contentTypes.js', async (orig) => ({
  ...(await orig()),
  getCommunityTabs: () => ['home', 'chat', 'calendar', 'settings']
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { openModal: (/** @type {any[]} */ ...args) => state.openModal(...args) }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    calendar: { timeFormat: '24h' },
    get discover() {
      return { contentTypes: state.discoverTypes };
    }
  }
}));
vi.mock('$lib/paraglide/messages', () => ({
  dashboard_communities_title: () => 'Communities',
  dashboard_communities_find: () => 'Finden',
  dashboard_communities_row_new: () => 'neu',
  dashboard_communities_discover: () => 'Entdecken',
  dashboard_communities_discover_subtitle: () => 'Communities finden und beitreten',
  dashboard_communities_create: () => 'Neue Community gründen',
  dashboard_communities_create_subtitle: () => 'Eigene Community gründen',
  dashboard_communities_empty: () => 'Du folgst noch keiner Community.',
  dashboard_communities_loading: () => 'Lade…',
  dashboard_communities_unavailable: () => 'Nicht ladbar',
  dashboard_communities_retry: () => 'Erneut',
  community_layout_bottom_tab_bar_home: () => 'Startseite',
  community_layout_bottom_tab_bar_chat: () => 'Chat',
  community_layout_bottom_tab_bar_calendar: () => 'Kalender',
  community_layout_bottom_tab_bar_learning: () => 'Lernen',
  community_layout_bottom_tab_bar_boards: () => 'Boards',
  community_layout_bottom_tab_bar_articles: () => 'Artikel',
  community_layout_bottom_tab_bar_forum: () => 'Forum',
  community_wikis_title: () => 'Wikis',
  community_layout_bottom_tab_bar_social_bookmarks: () => 'Lesezeichen',
  community_layout_bottom_tab_bar_polls: () => 'Umfragen',
  community_layout_bottom_tab_bar_settings: () => 'Einstellungen',
  concord_tab_label: () => 'Kanäle'
}));

const { default: Phone } = await import('../dashboard/DashboardCommunitiesPhone.svelte');

const ev = (ts, kind = 31923, title = 'Netzwerktreffen') => ({
  id: `id-${ts}`,
  kind,
  created_at: ts,
  pubkey: 'f'.repeat(64),
  tags: [
    ['d', `d-${ts}`],
    ['title', title]
  ],
  content: ''
});

describe('DashboardCommunitiesPhone', () => {
  beforeEach(() => {
    state.joined = [B, A];
    state.status = 'ready';
    state.isLoading = false;
    state.perCommunity = new Map([
      [A, [ev(100), ev(300)]],
      [B, [ev(200, 9, 'hallo')]]
    ]);
    state.lastView = { [A]: { view: 'chat', at: 200 }, [B]: null };
    state.discoverTypes = ['events', 'communities'];
    state.openModal.mockReset();
  });

  it('orders rows by newest activity and links each to its target section', () => {
    const { getAllByTestId } = render(Phone);
    const rows = getAllByTestId(/^community-row-/).filter(
      (el) => !el.dataset.testid.startsWith('community-row-new-')
    );
    expect(rows.map((r) => r.getAttribute('href'))).toEqual([
      '/c/npub-a?view=calendar', // A: newest (300) > last visit (200) → calendar
      '/c/npub-b' // B: never visited → home
    ]);
    expect(rows[0].textContent).toContain('Alpha');
    expect(rows[0].textContent).toContain('Kalender');
    expect(rows[0].textContent).toContain('Netzwerktreffen');
    expect(rows[1].textContent).toContain('Chat');
  });

  it('badges only rows with activity newer than the last visit', () => {
    const { queryByTestId } = render(Phone);
    expect(queryByTestId(`community-row-new-${A}`)).not.toBeNull();
    expect(queryByTestId(`community-row-new-${B}`)).toBeNull();
  });

  it('a row without loaded activity shows the description and sorts last', () => {
    state.joined = [C, A];
    state.perCommunity = new Map([[A, [ev(300)]]]);
    const { getAllByTestId, getByTestId } = render(Phone);
    const rows = getAllByTestId(/^community-row-/).filter(
      (el) => !el.dataset.testid.startsWith('community-row-new-')
    );
    expect(rows.map((r) => r.dataset.testid)).toEqual([`community-row-${A}`, `community-row-${C}`]);
    expect(getByTestId(`community-row-${C}`).textContent).toContain('Nur Beschreibung');
  });

  it('Finden links to discover when the tab is enabled, else to /communities', () => {
    const first = render(Phone);
    expect(first.getByTestId('communities-find').getAttribute('href')).toBe(
      '/discover?type=communities'
    );
    first.unmount();
    state.discoverTypes = ['events'];
    const second = render(Phone);
    expect(second.getByTestId('communities-find').getAttribute('href')).toBe('/communities');
  });

  it('empty list shows the discover card first, then the create card which opens the modal', async () => {
    state.joined = [];
    state.perCommunity = new Map();
    const { getByTestId, queryAllByTestId } = render(Phone);
    expect(queryAllByTestId(/^community-row-/)).toHaveLength(0);
    const discover = getByTestId('dashboard-communities-discover-card');
    const create = getByTestId('communities-phone-create');
    expect(
      discover.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await fireEvent.click(create);
    expect(state.openModal).toHaveBeenCalledWith('createCommunity');
  });

  it('shows the unavailable alert with a retry button', async () => {
    state.status = 'unavailable';
    const { getByTestId } = render(Phone);
    await fireEvent.click(getByTestId('dashboard-communities-retry'));
    expect(state.retry).toHaveBeenCalled();
  });
});
