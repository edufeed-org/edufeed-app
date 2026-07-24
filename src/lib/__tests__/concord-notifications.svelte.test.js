// @ts-nocheck

/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { getReplaceable: () => undefined }
}));

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
  clearActiveConcordChannel,
  selectConcordChannel,
  getSelectedConcordChannel
} from '$lib/concord/active-channel.svelte.js';
import { goto } from '$app/navigation';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const CID = 'c'.repeat(64);
const CH = 'd'.repeat(64);
const CH2 = 'e'.repeat(64);

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

/**
 * Fake ConcordClient with one community, arbitrary channels (each with its own
 * cold Subject timeline so tests control emission order), and a direct-invite
 * watcher (CORD-05 mid-session key grants tick invites$ without re-emitting
 * channels$ — mirroring receiveChannelKeys()'s in-place material mutation).
 */
function fakeMultiClient({ channels, material }) {
  const timelines = Object.fromEntries(channels.map((c) => [c.channel_id, new Subject()]));
  const channels$ = new BehaviorSubject(channels);
  const communities$ = new BehaviorSubject([{ material, metadata: { name: 'Area' } }]);
  const community = {
    material,
    channels$,
    channelStore: vi.fn((id) => ({ timeline: vi.fn(() => timelines[id]) }))
  };
  const inviteWatcher = { invites$: new Subject() };
  return {
    communities$,
    channels$,
    timelines,
    inviteWatcher,
    directInviteWatcher$: new BehaviorSubject(inviteWatcher),
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

  it('keeps other channels persisted markers when auto-marking during partial bootstrap', async () => {
    const client = fakeMultiClient({
      channels: [
        { channel_id: CH, name: 'general', private: false },
        { channel_id: CH2, name: 'random', private: false }
      ],
      material: { community_id: CID, channels: [], name: 'Area' }
    });
    const storage = fakeStorage({
      'notif:read': JSON.stringify({ [`${CID}/${CH}`]: 50, [`${CID}/${CH2}`]: 70 })
    });
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();
    setActiveConcordChannel(CID, CH);
    // CH's timeline emits FIRST — before CH2 has folded anything — so the
    // active-channel auto-mark runs on a partial `summaries` snapshot.
    client.timelines[CH].next([rumor({ created_at: 100 })]);
    await flush();
    // CH2's persisted marker must survive in storage...
    expect(JSON.parse(storage.map.get('notif:read'))).toMatchObject({ [`${CID}/${CH2}`]: 70 });
    // ...and in the reactive map (rumor at 60 <= marker 70 stays read).
    client.timelines[CH2].next([rumor({ created_at: 60 })]);
    expect(channelUnreadState(CID, CH2).unread).toBe(false);
  });

  it('watches channels granted mid-session via direct invite', async () => {
    const material = { community_id: CID, channels: [], name: 'Area' };
    const client = fakeMultiClient({
      channels: [{ channel_id: CH, name: 'secret', private: true }],
      material
    });
    await startConcordNotifications({ client, storage: fakeStorage(), pubkey: ME });
    await flush();
    // Private channel without a held key -> inaccessible, no subscription.
    expect(client.timelines[CH].observers.length).toBe(0);
    // Direct invite grants the key: material mutated in place (no channels$
    // re-emit — see receiveChannelKeys), then invites$ ticks.
    material.channels.push({ id: CH });
    client.inviteWatcher.invites$.next([{}]);
    expect(client.timelines[CH].observers.length).toBe(1);
    client.timelines[CH].next([rumor({ created_at: 100 })]);
    expect(channelUnreadState(CID, CH).unread).toBe(true);
  });

  it('prunes markers when a community is confirmed gone', async () => {
    const client = fakeClient();
    const storage = fakeStorage({
      'notif:read': JSON.stringify({ [`${CID}/${CH}`]: 50 }),
      'notif:mention-read': JSON.stringify({ [CID]: 40 })
    });
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();
    client.communities$.next([]); // left / dissolved
    await flush();
    expect(JSON.parse(storage.map.get('notif:read'))).toEqual({});
    expect(JSON.parse(storage.map.get('notif:mention-read'))).toEqual({});
  });

  it('prunes a gone channels marker when channels$ confirms removal', async () => {
    const client = fakeMultiClient({
      channels: [
        { channel_id: CH, name: 'general', private: false },
        { channel_id: CH2, name: 'random', private: false }
      ],
      material: { community_id: CID, channels: [], name: 'Area' }
    });
    const storage = fakeStorage({
      'notif:read': JSON.stringify({ [`${CID}/${CH}`]: 50, [`${CID}/${CH2}`]: 70 })
    });
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();
    // CH2 deleted from the channel list -> its marker is pruned + persisted.
    client.channels$.next([{ channel_id: CH, name: 'general', private: false }]);
    await flush();
    expect(JSON.parse(storage.map.get('notif:read'))).toEqual({ [`${CID}/${CH}`]: 50 });
  });

  it('fires a Notification for a fresh post-start message when enabled', async () => {
    const created = [];
    class FakeNotification {
      static permission = 'granted';
      constructor(title, options) {
        created.push({ title, options });
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    const client = fakeClient();
    const storage = fakeStorage({ 'notif:toasts-enabled': '1' });
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();
    // Baseline fold (cache replay analog) — must NOT toast.
    client.timeline$.next([rumor({ created_at: 100 })]);
    expect(created).toHaveLength(0);
    // New message stamped AFTER service start.
    const fresh = Math.floor(Date.now() / 1000) + 10;
    client.timeline$.next([rumor({ created_at: fresh }), rumor({ created_at: 100 })]);
    expect(created).toHaveLength(1);
    expect(created[0].options.tag).toBe(`concord-${CH}`);
    vi.unstubAllGlobals();
  });

  it('toast click sets the shared channel selection before navigating', async () => {
    const instances = [];
    class FakeNotification {
      static permission = 'granted';
      constructor(title, options) {
        this.title = title;
        this.options = options;
        instances.push(this);
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    vi.spyOn(window, 'focus').mockImplementation(() => {});
    const client = fakeClient();
    const storage = fakeStorage({ 'notif:toasts-enabled': '1' });
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();
    // A DIFFERENT channel is already selected (mirrors a previously-viewed
    // channel winning PrivateChannelsView's deep-link seed guard).
    selectConcordChannel(CID, CH2);
    // Baseline fold — must NOT toast (cache replay analog).
    client.timeline$.next([rumor({ created_at: 100 })]);
    const fresh = Math.floor(Date.now() / 1000) + 10;
    client.timeline$.next([rumor({ created_at: fresh }), rumor({ created_at: 100 })]);
    expect(instances).toHaveLength(1);

    instances[0].onclick();
    expect(window.focus).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith(`/private/${CID}?channel=${CH}`);
    expect(getSelectedConcordChannel(CID)).toBe(CH);

    stopConcordNotifications();
    expect(getSelectedConcordChannel(CID)).toBe('');
    vi.unstubAllGlobals();
  });

  it('suppresses toasts for the visible active channel and for level=nothing', async () => {
    const created = [];
    class FakeNotification {
      static permission = 'granted';
      constructor(title, options) {
        created.push({ title, options });
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    const client = fakeClient();
    const storage = fakeStorage({ 'notif:toasts-enabled': '1' });
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();
    client.timeline$.next([rumor({ created_at: 100 })]);

    setActiveConcordChannel(CID, CH); // jsdom tab is 'visible'
    const fresh = Math.floor(Date.now() / 1000) + 10;
    client.timeline$.next([rumor({ created_at: fresh }), rumor({ created_at: 100 })]);
    expect(created).toHaveLength(0);

    clearActiveConcordChannel();
    await setChannelLevel(CID, CH, 'nothing');
    client.timeline$.next([rumor({ created_at: fresh + 5 }), rumor({ created_at: 100 })]);
    expect(created).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('scans the whole burst for a mention at level=mentions — a newer non-mention does not hide an older mention in the same emission', async () => {
    // Minor, final review: maybeToast used to inspect only the single
    // newest not-self rumor. A burst emission [newer non-mention, older
    // mention] would find the non-mention first and drop the mention
    // entirely at level 'mentions'.
    const created = [];
    class FakeNotification {
      static permission = 'granted';
      constructor(title, options) {
        created.push({ title, options });
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    const client = fakeClient();
    const storage = fakeStorage({ 'notif:toasts-enabled': '1' });
    await startConcordNotifications({ client, storage, pubkey: ME });
    await flush();
    await setChannelLevel(CID, CH, 'mentions');

    // Baseline fold — must NOT toast (cache replay analog).
    client.timeline$.next([rumor({ created_at: 100 })]);
    expect(created).toHaveLength(0);

    const base = Math.floor(Date.now() / 1000) + 10;
    // Burst arriving in ONE emission: a newer non-mention (base+10) and an
    // older mention (base+5), both newer than the baseline fold above.
    client.timeline$.next([
      rumor({ created_at: base + 10 }), // newer, not a mention
      rumor({ created_at: base + 5, tags: [['p', ME]] }), // older, IS a mention
      rumor({ created_at: 100 })
    ]);
    expect(created).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
