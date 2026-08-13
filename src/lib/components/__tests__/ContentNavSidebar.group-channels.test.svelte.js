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
import { channelKey } from '$lib/groups/community-pointer.js';
import { groupHref } from '$lib/groups/groups.js';

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
  manager: mockManager
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
  channelUnreadState: () => notifFixture.channel
}));

const selectedChannelFixture = vi.hoisted(() => /** @type {{ value: string }} */ ({ value: '' }));
vi.mock('$lib/concord/active-channel.svelte.js', () => ({
  getSelectedConcordChannel: () => selectedChannelFixture.value
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
  const pointer = { id: 'chan-open', relay: RELAY, name: 'Open Channel' };
  const metadata = { kind: GROUP_METADATA_KIND, tags: [['name', 'Open Channel']] };
  return /** @type {any} */ (
    buildChannelRows({
      groupPointers: [pointer],
      metadataByKey: { [/** @type {string} */ (channelKey(pointer))]: metadata }
    })[0]
  );
}

/**
 * A members-only NIP-29 row (`private` tag present).
 * @returns {import('$lib/groups/community-channel-rows.js').GroupChannelRow}
 */
function membersOnlyGroupRow() {
  const pointer = { id: 'chan-private', relay: RELAY, name: 'Private Channel' };
  const metadata = { kind: GROUP_METADATA_KIND, tags: [['private', '']] };
  return /** @type {any} */ (
    buildChannelRows({
      groupPointers: [pointer],
      metadataByKey: { [/** @type {string} */ (channelKey(pointer))]: metadata }
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
  });

  it('a NIP-29 row links out to the group route', () => {
    const row = worldReadableGroupRow();
    renderNav({ channelRows: [row], isMember: true });
    const link = screen.getByTestId(`nav-channel-row-${sanitize(row.key)}`);
    expect(link.getAttribute('href')).toBe(groupHref(row.pointer));
  });

  it('the channels tab id never renders as a row in the Inhalte zone', () => {
    renderNav({
      channelRows: [worldReadableGroupRow()],
      isMember: true
    });
    expect(screen.queryByTestId('content-nav-channels')).toBeNull();
  });
});

/** @param {string} key */
function sanitize(key) {
  return key.replace(/[^a-zA-Z0-9]/g, '-');
}
