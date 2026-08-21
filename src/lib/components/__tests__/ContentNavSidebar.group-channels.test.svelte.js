/** @vitest-environment jsdom */
/**
 * ContentNavSidebar — two-zone sidebar (Task 7).
 *
 * Was: pins for the 'channels' TAB opening for a NIP-29-extended community.
 * That tab no longer renders on desktop at all — buildSidebarZones (Task 6,
 * unit-tested there) drops 'channels' from every zone, and the Kanäle zone
 * (channel ROWS, not a tab) takes over. This file now pins the zone
 * behavior: what a member/visitor/owner sees, that the channels tab id never
 * reappears as a row, and that a Concord row's click and a NIP-29 row's href
 * carry the right navigation payload.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { GROUP_METADATA_KIND } from 'applesauce-common/helpers/groups';
import { buildChannelRows } from '$lib/groups/community-channel-rows.js';

const OWNER = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);
const RELAY = 'wss://groups.example';

// Default: nobody holds the community's key — every test is a stranger
// unless it explicitly proves the owner path.
const mockManager = vi.hoisted(() => ({
  getAccountForPubkey: vi.fn(
    (/** @type {string} */ _pk) =>
      /** @type {{ signer: { sign: () => void } } | undefined} */ (undefined)
  )
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: STRANGER }),
  manager: mockManager,
  accountsMeta: { version: 0 }
}));

const concordFixture = vi.hoisted(
  () =>
    /** @type {{ value: any }} */ ({
      value: { enabled: false, pointer: undefined, membership: 'none', community: undefined }
    })
);
vi.mock('$lib/concord/community.svelte.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    useConcordCommunity: () => () => concordFixture.value
  };
});

const notifFixture = vi.hoisted(
  () =>
    /** @type {{ area: any, channel: any }} */ ({
      area: { unread: false, mentioned: false },
      channel: { unread: false, mentioned: false }
    })
);
vi.mock('$lib/concord/notifications.svelte.js', () => ({
  areaUnreadState: () => notifFixture.area,
  channelUnreadState: () => notifFixture.channel,
  getToastsEnabled: () => false,
  setToastsEnabled: async () => {}
}));

const selectedChannelFixture = vi.hoisted(() => /** @type {{ value: string }} */ ({ value: '' }));
const selectConcordChannelSpy = vi.hoisted(() => vi.fn());
vi.mock('$lib/concord/active-channel.svelte.js', () => ({
  getSelectedConcordChannel: () => selectedChannelFixture.value,
  selectConcordChannel: (/** @type {string} */ cid, /** @type {string} */ channelId) =>
    selectConcordChannelSpy(cid, channelId)
}));

import ContentNavSidebar from '$lib/components/community/layout/ContentNavSidebar.svelte';

/** @param {string[][]} tags */
const communityEvent = (tags = []) => ({
  kind: 10222,
  pubkey: OWNER,
  content: '',
  tags: [['d', 'relilab'], ...tags]
});

/** @param {Partial<Record<string, any>>} props */
function renderNav(props = {}) {
  return render(ContentNavSidebar, {
    props: {
      selectedContentType: 'home',
      onContentTypeSelect: vi.fn(),
      communityEvent: communityEvent(),
      channelRows: [],
      isMember: false,
      ...props
    }
  });
}

/**
 * A world-readable NIP-29 row (no `private` tag on its kind:39000).
 * @returns {import('$lib/groups/community-channel-rows.js').GroupChannelRow}
 */
function worldReadableGroupRow() {
  const metadata = {
    kind: GROUP_METADATA_KIND,
    tags: [
      ['d', 'chan-open'],
      ['name', 'Open Channel']
    ]
  };
  return /** @type {any} */ (
    buildChannelRows({
      subtreeChannels: [
        { id: 'chan-open', relay: RELAY, name: 'Open Channel', level: 'world', metadata }
      ]
    })[0]
  );
}

/**
 * A members-only NIP-29 row (`private` tag present).
 * @returns {import('$lib/groups/community-channel-rows.js').GroupChannelRow}
 */
function membersOnlyGroupRow() {
  const metadata = {
    kind: GROUP_METADATA_KIND,
    tags: [
      ['d', 'chan-private'],
      ['private', '']
    ]
  };
  return /** @type {any} */ (
    buildChannelRows({
      subtreeChannels: [
        { id: 'chan-private', relay: RELAY, name: 'Private Channel', level: 'invited', metadata }
      ]
    })[0]
  );
}

/** A Concord channel row. */
function concordRow() {
  return buildChannelRows({
    concordChannels: [{ channel_id: 'general', name: 'General', accessible: true, private: false }]
  })[0];
}

describe('ContentNavSidebar — two-zone sidebar', () => {
  afterEach(() => {
    mockManager.getAccountForPubkey.mockReset();
    mockManager.getAccountForPubkey.mockImplementation(() => undefined);
    concordFixture.value = {
      enabled: false,
      pointer: undefined,
      membership: 'none',
      community: undefined
    };
    selectedChannelFixture.value = '';
    selectConcordChannelSpy.mockReset();
  });

  it('a member sees both zones and the footer', () => {
    renderNav({
      channelRows: [worldReadableGroupRow(), membersOnlyGroupRow()],
      isMember: true
    });
    expect(screen.queryByTestId('nav-zone-inhalte')).not.toBeNull();
    expect(screen.queryByTestId('nav-zone-kanaele')).not.toBeNull();
    // Every row visible — not just the world-readable one.
    expect(
      screen.queryByTestId(`nav-channel-row-${sanitize(worldReadableGroupRow().key)}`)
    ).not.toBeNull();
    expect(
      screen.queryByTestId(`nav-channel-row-${sanitize(membersOnlyGroupRow().key)}`)
    ).not.toBeNull();
    expect(screen.queryByTestId('nav-footer-members')).not.toBeNull();
    expect(screen.queryByTestId('nav-footer-settings')).not.toBeNull();
  });

  it('a visitor sees only world-readable rows, plus a lock hint', () => {
    renderNav({
      channelRows: [worldReadableGroupRow(), membersOnlyGroupRow()],
      isMember: false
    });
    expect(
      screen.queryByTestId(`nav-channel-row-${sanitize(worldReadableGroupRow().key)}`)
    ).not.toBeNull();
    expect(
      screen.queryByTestId(`nav-channel-row-${sanitize(membersOnlyGroupRow().key)}`)
    ).toBeNull();
    expect(screen.queryByTestId('nav-lock-hint')).not.toBeNull();
  });

  it('the owner sees every row too, key-holding not follow-set membership', () => {
    mockManager.getAccountForPubkey.mockImplementation((/** @type {string} */ pk) =>
      pk === OWNER ? { signer: { sign: () => {} } } : undefined
    );
    renderNav({
      channelRows: [worldReadableGroupRow(), membersOnlyGroupRow()],
      isMember: false
    });
    expect(
      screen.queryByTestId(`nav-channel-row-${sanitize(membersOnlyGroupRow().key)}`)
    ).not.toBeNull();
    expect(screen.queryByTestId('nav-lock-hint')).toBeNull();
  });

  it('the Kanäle zone is hidden entirely for an open community with no channels', () => {
    renderNav({ channelRows: [], isMember: false });
    expect(screen.queryByTestId('nav-zone-kanaele')).toBeNull();
    expect(screen.queryByTestId('nav-lock-hint')).toBeNull();
  });

  it('a Concord row click navigates with the channel id', async () => {
    const onContentTypeSelect = vi.fn();
    concordFixture.value = {
      enabled: true,
      pointer: { communityId: 'area-1' },
      membership: 'member',
      community: {}
    };
    const row = concordRow();
    const { getByTestId } = renderNav({
      channelRows: [row],
      isMember: true,
      onContentTypeSelect
    });
    await fireEvent.click(getByTestId(`nav-channel-row-${sanitize(row.key)}`));
    expect(onContentTypeSelect).toHaveBeenCalledWith('channels', 'general');
    expect(selectConcordChannelSpy).toHaveBeenCalledWith('area-1', 'general');
  });

  // Bug (review of 187b4c0b, critical 1): PrivateChannelsView only seeds its
  // channel from the `?channel=` URL param when NO selection exists yet for
  // this community (`!getSelectedConcordChannel(cid)`) — after the first
  // pick that guard is closed for the rest of the session, so later clicks
  // silently stopped switching channels. The row's click handler must set
  // the shared selection directly, not rely on the URL param alone.
  it('re-clicking a different row while a selection already exists calls selectConcordChannel with the new id', async () => {
    const onContentTypeSelect = vi.fn();
    concordFixture.value = {
      enabled: true,
      pointer: { communityId: 'area-1' },
      membership: 'member',
      community: {}
    };
    // A selection already exists for this community — the exact state that
    // permanently closes PrivateChannelsView's deep-link guard.
    selectedChannelFixture.value = 'general';
    const rows = buildChannelRows({
      concordChannels: [
        { channel_id: 'general', name: 'General', accessible: true, private: false },
        { channel_id: 'random', name: 'Random', accessible: true, private: false }
      ]
    });
    const randomRow = /** @type {any} */ (
      rows.find((r) => /** @type {any} */ (r).channel_id === 'random')
    );
    const { getByTestId } = renderNav({
      channelRows: rows,
      isMember: true,
      onContentTypeSelect
    });
    await fireEvent.click(getByTestId(`nav-channel-row-${sanitize(randomRow.key)}`));
    expect(selectConcordChannelSpy).toHaveBeenCalledWith('area-1', 'random');
    expect(onContentTypeSelect).toHaveBeenCalledWith('channels', 'random');
  });

  // Community channels select IN PLACE (group-channel-selection store) and
  // render inside the community pane — the standalone /groups route with its
  // full host directory is for browsing a relay, not for a community's own
  // channels (laoc, 2026-08-19).
  it('a NIP-29 row selects in place and switches to the channels view', async () => {
    const row = worldReadableGroupRow();
    const onContentTypeSelect = vi.fn();
    renderNav({ channelRows: [row], isMember: true, onContentTypeSelect });
    const el = screen.getByTestId(`nav-channel-row-${sanitize(row.key)}`);
    expect(el.getAttribute('href')).toBeNull();
    await fireEvent.click(el);
    expect(onContentTypeSelect).toHaveBeenCalledWith('channels', undefined);
  });

  // 8d03f873 widened create to root-39001 admins, but only on the mobile
  // rail — the desktop zone's entry stayed key-holder-only. Pins that the
  // isRootAdmin prop actually reaches buildSidebarZones (laoc, 2026-08-21).
  it('a non-owner root-39001 admin of a moderated community gets the create entry', () => {
    renderNav({
      communityEvent: communityEvent([['membership', 'root-group', RELAY]]),
      isMember: true,
      isRootAdmin: true
    });
    expect(screen.queryByTestId('nav-channels-create')).not.toBeNull();
  });

  it('a plain member of a moderated community gets no create entry', () => {
    renderNav({
      communityEvent: communityEvent([['membership', 'root-group', RELAY]]),
      isMember: true
    });
    expect(screen.queryByTestId('nav-channels-create')).toBeNull();
  });

  it('the channels tab id never renders as a row in the Inhalte zone', () => {
    renderNav({
      channelRows: [worldReadableGroupRow()],
      isMember: true
    });
    expect(screen.queryByTestId('content-nav-channels')).toBeNull();
  });

  // Important 1: buildSidebarZones deliberately drops 'home' from every zone
  // (design: "home handled by the header row") — this pins that the header
  // row is actually wired up to that job, not just decorative.
  it('clicking the community header navigates to home', async () => {
    const onContentTypeSelect = vi.fn();
    const { getByTestId } = renderNav({
      communityProfile: { name: 'Relilab' },
      onContentTypeSelect
    });
    await fireEvent.click(getByTestId('nav-header-home'));
    expect(onContentTypeSelect).toHaveBeenCalledWith('home', undefined);
  });

  it('the community header renders active styling when home is selected', () => {
    const { getByTestId } = renderNav({
      communityProfile: { name: 'Relilab' },
      selectedContentType: 'home'
    });
    expect(getByTestId('nav-header-home').className).toContain('bg-primary');
  });

  it('the community header is not active styling when another tab is selected', () => {
    const { getByTestId } = renderNav({
      communityProfile: { name: 'Relilab' },
      selectedContentType: 'chat'
    });
    expect(getByTestId('nav-header-home').className).not.toContain('bg-primary');
  });
});

/** @param {string} key */
function sanitize(key) {
  return key.replace(/[^a-zA-Z0-9]/g, '-');
}
