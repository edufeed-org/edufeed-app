// @ts-nocheck

/**
 * Task 6 follow-up (carried from the Task 5 review): the area/tab rollup
 * dots all read `areaUnreadState`/`channelUnreadState` via a template
 * `{@const flags = ...}` inside an {#each} block, mirroring
 * PrivateChannelsView's channel-row pattern. That pattern was never proven
 * to actually re-render a mounted component when the notifications
 * service's module `$state.raw` changes — this test mounts a real
 * component (not just an `$effect.root` probe) to close that gap.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { render, within } from '@testing-library/svelte';
import { BehaviorSubject } from 'rxjs';
import {
  startConcordNotifications,
  stopConcordNotifications,
  markChannelRead
} from '$lib/concord/notifications.svelte.js';
import { clearActiveConcordChannel } from '$lib/concord/active-channel.svelte.js';
import Host from '$lib/components/__tests__/fixtures/ChannelUnreadFlagsHost.svelte';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const CID = 'c'.repeat(64);
const CH = 'd'.repeat(64);

/** @param {{pubkey?: string, created_at: number, tags?: string[][]}} args */
function rumor({ pubkey = OTHER, created_at, tags = [] }) {
  return { id: `${pubkey}-${created_at}`, kind: 9, pubkey, created_at, tags, content: 'x' };
}

/** In-memory ConcordStorage — copied from concord-notifications.svelte.test.js. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: vi.fn(async (k) => map.get(k) ?? null),
    setItem: vi.fn(async (k, v) => void map.set(k, v)),
    removeItem: vi.fn(async (k) => void map.delete(k))
  };
}

/** Fake ConcordClient with one community and one channel timeline — copied
 * from concord-notifications.svelte.test.js. */
function fakeClient() {
  const timeline$ = new BehaviorSubject([]);
  const channels$ = new BehaviorSubject([{ channel_id: CH, name: 'general', private: false }]);
  const communities$ = new BehaviorSubject([
    { material: { community_id: CID, channels: [], name: 'Area' }, metadata: { name: 'Area' } }
  ]);
  const community = {
    material: { community_id: CID, channels: [], name: 'Area' },
    channels$,
    channelStore: vi.fn(() => ({ timeline: vi.fn(() => timeline$) }))
  };
  return {
    communities$,
    channels$,
    timeline$,
    getCommunity: vi.fn(() => community)
  };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('area rollup dot — render-level reactivity', () => {
  beforeEach(() => {
    stopConcordNotifications();
    clearActiveConcordChannel();
  });

  it('mounts the dot on a new rumor and clears it after markChannelRead', async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();

    const { container } = render(Host, {
      props: { communityId: CID, channels: [{ id: CH }] }
    });
    flushSync();

    const row = within(container).getByTestId(`channel-row-${CH}`);
    expect(within(row).queryByTestId('concord-unread-dot')).toBeNull();

    client.timeline$.next([rumor({ created_at: 100 })]);
    flushSync();

    expect(within(row).getByTestId('concord-unread-dot')).toBeTruthy();

    markChannelRead(CID, CH);
    flushSync();

    expect(within(row).queryByTestId('concord-unread-dot')).toBeNull();
  });
});
