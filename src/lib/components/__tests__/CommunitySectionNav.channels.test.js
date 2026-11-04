// @ts-nocheck
/** @vitest-environment jsdom */
// The Bereiche sheet lists the channels directly below the section tiles
// (same zone split as the desktop sidebar), so a channel is two taps from
// any section: button → row. Members see every row, visitors only
// world-readable ones plus the lock hint, owners/root admins a create entry.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const state = vi.hoisted(() => ({
  tabs: ['home', 'chat', 'channels', 'settings'],
  owner: false,
  selectGroupChannel: vi.fn(),
  selectConcordChannel: vi.fn(),
  requestChannelCreate: vi.fn(),
  requestChannelList: vi.fn()
}));

vi.mock('$lib/concord/community.svelte.js', () => ({
  useConcordCommunity: () => () => ({
    enabled: true,
    pointer: { communityId: 'cid' },
    membership: 'member'
  })
}));
vi.mock('$lib/concord/notifications.svelte.js', () => ({
  areaUnreadState: () => ({ unread: false, mentioned: false }),
  channelUnreadState: () => ({ unread: false, mentioned: false })
}));
vi.mock('$lib/concord/active-channel.svelte.js', () => ({
  getSelectedConcordChannel: () => null,
  selectConcordChannel: (...args) => state.selectConcordChannel(...args),
  requestChannelCreate: () => state.requestChannelCreate()
}));
vi.mock('$lib/groups/group-channel-selection.svelte.js', () => ({
  getSelectedGroupChannel: () => null,
  selectGroupChannel: (...args) => state.selectGroupChannel(...args),
  requestChannelList: (pk) => state.requestChannelList(pk)
}));
vi.mock('$lib/groups/channel-mentions.svelte.js', () => ({
  hasUnreadChannelMention: () => false
}));
vi.mock('$lib/groups/favourite-channels.svelte.js', () => ({
  readFavouriteChannels: () => new Set()
}));
vi.mock('$lib/helpers/community-signer.js', () => ({
  isCommunityOwner: () => state.owner
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: 'u'.repeat(64) })
}));
vi.mock('$lib/components/community/layout/community-nav.js', async (orig) => ({
  ...(await orig()),
  communityNavTabIds: () => state.tabs
}));
vi.mock('$lib/paraglide/messages', () => ({
  aria_close_modal: () => 'Schließen',
  community_sections_title: () => 'Bereiche',
  community_sections_count: ({ count }) => `${count} Bereiche`,
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
  community_content_tab_restricted: () => 'Gesperrt',
  community_nav_kanaele: () => 'Kanäle',
  community_nav_lock_hint: () => 'Weitere Kanäle nur für Mitglieder',
  concord_new_channel: () => 'Neuer Kanal',
  groups_rail_favourites: () => 'Favoriten',
  channel_hidden_tooltip: () => 'channel_hidden_tooltip',
  channel_lock_tooltip: () => 'channel_lock_tooltip',
  concord_legend_private: () => 'concord_legend_private',
  concord_legend_public: () => 'concord_legend_public',
  groups_channel_world_readable: () => 'Öffentlich'
}));

const { default: Nav } = await import('../community/layout/CommunitySectionNav.svelte');
const COMMUNITY = 'c'.repeat(64);
const event = { kind: 10222, pubkey: COMMUNITY, content: '', tags: [] };
const rows = () => [
  {
    source: 'group',
    key: 'group:abc',
    name: 'Allgemein',
    symbol: '#',
    worldReadable: true,
    locked: false,
    accessible: true,
    pending: false,
    category: 'channel',
    level: 'open',
    av: false,
    pointer: { id: 'abc', relay: 'wss://g' }
  },
  {
    source: 'concord',
    key: 'concord:x',
    name: 'Intern',
    symbol: '🔒',
    worldReadable: false,
    locked: true,
    accessible: true,
    pending: false,
    channel_id: 'x'
  }
];
const base = (extra = {}) => ({
  selectedContentType: 'home',
  onContentTypeSelect: vi.fn(),
  communityEvent: event,
  restrictedTabs: new Set(),
  accessibleTabs: new Set(),
  channelRows: rows(),
  isMember: true,
  isRootAdmin: false,
  ...extra
});

describe('CommunitySectionNav — channel rows in the sheet', () => {
  beforeEach(() => {
    state.tabs = ['home', 'chat', 'channels', 'settings'];
    state.owner = false;
    state.selectGroupChannel.mockReset();
    state.selectConcordChannel.mockReset();
    state.requestChannelCreate.mockReset();
    document.body.style.overflow = '';
  });

  it('lists channel rows for a member and selects + closes on tap', async () => {
    const props = base();
    const { getByTestId, getAllByTestId, queryByTestId } = render(Nav, props);
    await fireEvent.click(getByTestId('section-open'));
    expect(getByTestId('section-channels')).toBeTruthy();
    expect(getAllByTestId(/^section-channel-row-/)).toHaveLength(2);
    await fireEvent.click(getByTestId('section-channel-row-group-abc'));
    expect(state.selectGroupChannel).toHaveBeenCalledTimes(1);
    expect(state.selectGroupChannel.mock.calls[0][0]).toBe(COMMUNITY);
    expect(props.onContentTypeSelect).toHaveBeenCalledWith('channels', 'abc');
    expect(queryByTestId('section-sheet')).toBeNull();
  });

  it('a concord row selects the concord channel by id', async () => {
    const props = base();
    const { getByTestId } = render(Nav, props);
    await fireEvent.click(getByTestId('section-open'));
    await fireEvent.click(getByTestId('section-channel-row-concord-x'));
    expect(state.selectConcordChannel).toHaveBeenCalledWith('cid', 'x');
    expect(props.onContentTypeSelect).toHaveBeenCalledWith('channels', 'x');
  });

  it('a visitor sees only world-readable rows plus the lock hint', async () => {
    const { getByTestId, getAllByTestId } = render(Nav, base({ isMember: false }));
    await fireEvent.click(getByTestId('section-open'));
    expect(getAllByTestId(/^section-channel-row-/).map((el) => el.dataset.testid)).toEqual([
      'section-channel-row-group-abc'
    ]);
    expect(getByTestId('section-lock-hint')).toBeTruthy();
  });

  it('owner gets the create entry, which requests the wizard and opens Kanäle', async () => {
    state.owner = true;
    const props = base();
    const { getByTestId } = render(Nav, props);
    await fireEvent.click(getByTestId('section-open'));
    await fireEvent.click(getByTestId('section-channel-create'));
    expect(state.requestChannelCreate).toHaveBeenCalledTimes(1);
    expect(props.onContentTypeSelect).toHaveBeenCalledWith('channels');
  });

  it('no zone at all when there is nothing to list and nothing to create', async () => {
    const { getByTestId, queryByTestId } = render(Nav, base({ channelRows: [], isMember: true }));
    await fireEvent.click(getByTestId('section-open'));
    expect(queryByTestId('section-channels')).toBeNull();
  });
});
