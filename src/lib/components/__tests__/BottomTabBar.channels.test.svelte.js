/** @vitest-environment jsdom */
/**
 * BottomTabBar — the "Kanäle" tab (design 1a, laoc 2026-10-02).
 *
 * The tab wears the two-speech-bubbles ChannelsIcon (the lock read as
 * "locked away", and the per-channel lock in the list already means
 * "private"), and tapping it while a channel is open goes back to the
 * channel list instead of doing nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/concord/community.svelte.js', () => ({
  useConcordCommunity: () => () => ({ enabled: false, pointer: null, membership: 'none' })
}));
vi.mock('$lib/concord/notifications.svelte.js', () => ({
  areaUnreadState: () => ({ unread: false, mentioned: false })
}));
vi.mock('$lib/components/community/layout/community-nav.js', () => ({
  communityNavTabIds: () => ['home', 'chat', 'channels']
}));
vi.mock('$lib/components/icons', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  const { default: Stub } = await import('./fixtures/IconMarkerStub.svelte');
  return { ...actual, ChannelsIcon: Stub };
});

import BottomTabBar from '$lib/components/community/layout/BottomTabBar.svelte';
import {
  selectGroupChannel,
  getSelectedGroupChannel
} from '$lib/groups/group-channel-selection.svelte.js';

const COMMUNITY = 'c'.repeat(64);
const event = { kind: 10222, pubkey: COMMUNITY, content: '', tags: [] };

beforeEach(() => {
  selectGroupChannel(COMMUNITY, "wss://groups.example/'arbeitszimmer");
});

describe('BottomTabBar — Kanäle tab', () => {
  it('draws the channels icon, not the lock', () => {
    render(BottomTabBar, {
      props: { selectedContentType: 'chat', communityEvent: event, onContentTypeSelect: vi.fn() }
    });
    const tab = screen.getByRole('button', { name: /^(Kanäle|Channels)$/ });
    expect(tab.querySelector('[data-testid="icon-marker-stub"]')).not.toBeNull();
  });

  it('a tap while a channel is open clears the selection (back to the list)', async () => {
    const onContentTypeSelect = vi.fn();
    render(BottomTabBar, {
      props: { selectedContentType: 'channels', communityEvent: event, onContentTypeSelect }
    });
    await fireEvent.click(screen.getByRole('button', { name: /^(Kanäle|Channels)$/ }));
    expect(getSelectedGroupChannel(COMMUNITY)).toBe('');
    expect(onContentTypeSelect).toHaveBeenCalledWith('channels');
  });

  it('other tabs leave the channel selection alone', async () => {
    const onContentTypeSelect = vi.fn();
    render(BottomTabBar, {
      props: { selectedContentType: 'channels', communityEvent: event, onContentTypeSelect }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(getSelectedGroupChannel(COMMUNITY)).toBe("wss://groups.example/'arbeitszimmer");
  });
});
