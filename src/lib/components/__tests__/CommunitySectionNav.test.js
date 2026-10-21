/** @vitest-environment jsdom */
// Phone section switcher: sticky row (Bereiche chip + current section) and a
// sheet with every section as a tile. Replaces the scrolling BottomTabBar.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { flushSync } from 'svelte';

const state = vi.hoisted(() => ({
  tabs: ['home', 'chat', 'calendar', 'forum', 'settings'],
  requested: /** @type {string[]} */ ([])
}));

vi.mock('$lib/concord/community.svelte.js', () => ({
  useConcordCommunity: () => () => ({ enabled: false, pointer: null, membership: 'none' })
}));
vi.mock('$lib/concord/notifications.svelte.js', () => ({
  areaUnreadState: () => ({ unread: false, mentioned: false })
}));
vi.mock('$lib/groups/group-channel-selection.svelte.js', () => ({
  requestChannelList: (/** @type {string} */ pk) => state.requested.push(pk)
}));
vi.mock('$lib/components/community/layout/community-nav.js', () => ({
  communityNavTabIds: () => state.tabs
}));
vi.mock('$lib/paraglide/messages', () => ({
  aria_close_modal: () => 'Schließen',
  community_sections_title: () => 'Bereiche',
  community_sections_open_aria: () => 'Bereiche öffnen',
  community_sections_legend_members_only: () => 'nur für Mitglieder',
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
  concord_tab_label: () => 'Kanäle',
  community_content_tab_access_granted: () => 'Zugang',
  community_content_tab_restricted: () => 'Gesperrt'
}));

const { default: Nav } = await import('../community/layout/CommunitySectionNav.svelte');
const COMMUNITY = 'c'.repeat(64);
const event = { kind: 10222, pubkey: COMMUNITY, content: '', tags: [] };
const base = () => ({
  selectedContentType: 'calendar',
  onContentTypeSelect: vi.fn(),
  communityEvent: event,
  restrictedTabs: new Set(),
  accessibleTabs: new Set()
});

describe('CommunitySectionNav', () => {
  beforeEach(() => {
    state.tabs = ['home', 'chat', 'calendar', 'forum', 'settings'];
    state.requested = [];
    document.body.style.overflow = '';
  });

  it('shows the current section in the row and no sheet until tapped', () => {
    const { getByTestId, queryByTestId } = render(Nav, base());
    expect(getByTestId('section-current').textContent).toContain('Kalender');
    expect(queryByTestId('section-sheet')).toBeNull();
  });

  it('opens a grid of all tabs in order with the current one marked', async () => {
    const { getByTestId, getAllByTestId } = render(Nav, base());
    await fireEvent.click(getByTestId('section-open'));
    const tiles = getAllByTestId(/^section-tile-/).map((t) => t.dataset.testid);
    expect(tiles).toEqual([
      'section-tile-home',
      'section-tile-chat',
      'section-tile-calendar',
      'section-tile-forum',
      'section-tile-settings'
    ]);
    expect(getByTestId('section-tile-calendar').getAttribute('aria-current')).toBe('page');
    expect(getByTestId('section-sheet').textContent).toContain('nur für Mitglieder');
  });

  it('marks restricted tabs closed or open', async () => {
    const props = base();
    props.restrictedTabs = new Set(['chat', 'forum']);
    props.accessibleTabs = new Set(['forum']);
    const { getByTestId, queryByTestId } = render(Nav, props);
    await fireEvent.click(getByTestId('section-open'));
    expect(getByTestId('section-lock-chat').dataset.state).toBe('closed');
    expect(getByTestId('section-lock-forum').dataset.state).toBe('open');
    expect(queryByTestId('section-lock-home')).toBeNull();
  });

  it('tile tap selects and closes', async () => {
    const props = base();
    const { getByTestId, queryByTestId } = render(Nav, props);
    await fireEvent.click(getByTestId('section-open'));
    await fireEvent.click(getByTestId('section-tile-forum'));
    expect(props.onContentTypeSelect).toHaveBeenCalledWith('forum');
    expect(queryByTestId('section-sheet')).toBeNull();
  });

  it('the channels tile also returns to the channel list', async () => {
    state.tabs = ['home', 'chat', 'channels', 'settings'];
    const props = base();
    const { getByTestId } = render(Nav, props);
    await fireEvent.click(getByTestId('section-open'));
    await fireEvent.click(getByTestId('section-tile-channels'));
    expect(state.requested).toEqual([COMMUNITY]);
    expect(props.onContentTypeSelect).toHaveBeenCalledWith('channels');
  });

  it('tiles follow the tab list', async () => {
    const props = base();
    const { getByTestId, queryByTestId, rerender } = render(Nav, props);
    await fireEvent.click(getByTestId('section-open'));
    expect(queryByTestId('section-tile-learning')).toBeNull();
    state.tabs = ['home', 'learning', 'settings'];
    await rerender({ ...props, communityEvent: { ...event, tags: [['x']] } });
    flushSync();
    expect(getByTestId('section-tile-learning')).toBeTruthy();
  });
});
