// @ts-nocheck

/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import {
  startConcordNotifications,
  stopConcordNotifications,
  markChannelRead,
  channelUnreadState,
  areaUnreadState,
  getChannelLevel,
  setChannelLevel
} from '$lib/concord/notifications.svelte.js';
import {
  setActiveConcordChannel,
  clearActiveConcordChannel
} from '$lib/concord/active-channel.svelte.js';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const CID = 'c'.repeat(64);
const CH = 'd'.repeat(64);

function rumor({ pubkey = OTHER, created_at, tags = [] }) {
  return { id: `${pubkey}-${created_at}`, kind: 9, pubkey, created_at, tags, content: 'x' };
}

/** In-memory ConcordStorage. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: vi.fn(async (k) => map.get(k) ?? null),
    setItem: vi.fn(async (k, v) => void map.set(k, v)),
    removeItem: vi.fn(async (k) => void map.delete(k))
  };
}

/** Fake ConcordClient with one community and one channel timeline. */
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

describe('concord notifications service', () => {
  beforeEach(() => {
    stopConcordNotifications();
    clearActiveConcordChannel();
  });

  it('flags unread for a new message from someone else, clears via markChannelRead', async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();

    client.timeline$.next([rumor({ created_at: 100 })]);
    expect(channelUnreadState(CID, CH)).toEqual({ unread: true, mentioned: false });
    expect(areaUnreadState(CID)).toEqual({ unread: true, mentioned: false });

    markChannelRead(CID, CH);
    expect(channelUnreadState(CID, CH)).toEqual({ unread: false, mentioned: false });
    expect(areaUnreadState(CID)).toEqual({ unread: false, mentioned: false });
    // persisted
    await flush();
    expect(storage.setItem).toHaveBeenCalledWith(
      'notif:read',
      expect.stringContaining(`${CID}/${CH}`)
    );
  });

  it('own messages never light unread; p-tag mentions light the mention tier', async () => {
    const client = fakeClient();
    await startConcordNotifications({ client, storage: fakeStorage(), pubkey: ME });
    await flush();

    client.timeline$.next([rumor({ pubkey: ME, created_at: 100 })]);
    expect(channelUnreadState(CID, CH)).toEqual({ unread: false, mentioned: false });

    client.timeline$.next([
      rumor({ created_at: 200, tags: [['p', ME]] }),
      rumor({ pubkey: ME, created_at: 100 })
    ]);
    expect(channelUnreadState(CID, CH)).toEqual({ unread: true, mentioned: true });
    expect(areaUnreadState(CID).mentioned).toBe(true);
  });

  it('loads persisted markers before flagging (no unread flash after reload)', async () => {
    const client = fakeClient();
    const storage = fakeStorage({ 'notif:read': JSON.stringify({ [`${CID}/${CH}`]: 100 }) });
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();

    client.timeline$.next([rumor({ created_at: 100 })]);
    expect(channelUnreadState(CID, CH)).toEqual({ unread: false, mentioned: false });
    client.timeline$.next([rumor({ created_at: 150 }), rumor({ created_at: 100 })]);
    expect(channelUnreadState(CID, CH).unread).toBe(true);
  });

  it('auto-marks the active visible channel as read on new rumors', async () => {
    const client = fakeClient();
    await startConcordNotifications({ client, storage: fakeStorage(), pubkey: ME });
    await flush();
    setActiveConcordChannel(CID, CH);
    // jsdom documents report visibilityState 'visible' by default
    client.timeline$.next([rumor({ created_at: 100 })]);
    expect(channelUnreadState(CID, CH).unread).toBe(false);
  });

  it('stores and resolves per-channel levels', async () => {
    const client = fakeClient();
    const storage = fakeStorage();
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();
    expect(getChannelLevel(CID, CH)).toBe('all');
    await setChannelLevel(CID, CH, 'mentions');
    expect(getChannelLevel(CID, CH)).toBe('mentions');
    expect(storage.setItem).toHaveBeenCalledWith(
      'notif:levels',
      expect.stringContaining('mentions')
    );
  });

  it('stop() tears down and getters return all-read defaults', async () => {
    const client = fakeClient();
    await startConcordNotifications({ client, storage: fakeStorage(), pubkey: ME });
    await flush();
    client.timeline$.next([rumor({ created_at: 100 })]);
    expect(channelUnreadState(CID, CH).unread).toBe(true);
    stopConcordNotifications();
    expect(channelUnreadState(CID, CH)).toEqual({ unread: false, mentioned: false });
    expect(client.timeline$.observers.length).toBe(0);
  });
});
