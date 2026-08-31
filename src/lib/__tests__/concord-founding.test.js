/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildPointerUpdate,
  foundConcordArea,
  readFoundingMarker,
  writeFoundingMarker,
  clearFoundingMarker
} from '$lib/concord/founding.js';

const CID = 'c'.repeat(64);
const PUBKEY = 'a'.repeat(64);

/** @type {{ client: any, publish: any }} */
const mockState = vi.hoisted(() => ({ client: null, publish: null }));

vi.mock('$lib/concord/client.svelte.js', () => ({
  getConcordClient: () => mockState.client
}));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (/** @type {any[]} */ ...args) => mockState.publish(...args)
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn() }
}));
vi.mock('$lib/helpers/communityRelays.js', () => ({
  getCommunityGlobalRelays: () => []
}));

/** Minimal Storage-shaped fake backed by a Map. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (/** @type {string} */ k) => map.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => map.set(k, v),
    removeItem: (/** @type {string} */ k) => map.delete(k),
    map
  };
}

describe('buildPointerUpdate', () => {
  it('produces an unsigned 10222 template preserving tags/content, adding the pointer', () => {
    const communikeyEvent = {
      kind: 10222,
      pubkey: PUBKEY,
      created_at: 1000,
      content: 'community definition',
      tags: [
        ['r', 'wss://x'],
        ['content', 'chat']
      ]
    };
    const template = buildPointerUpdate(communikeyEvent, CID, 'wss://concord.example');
    expect(template.kind).toBe(10222);
    expect(template.content).toBe('community definition');
    expect(template.tags).toContainEqual(['r', 'wss://x']);
    expect(template.tags).toContainEqual(['concord', CID, 'wss://concord.example']);
    expect(template.created_at).toBeGreaterThan(1000);
    expect(template).not.toHaveProperty('id');
    expect(template).not.toHaveProperty('sig');
  });

  it('replaces an existing pointer instead of duplicating', () => {
    const event = {
      kind: 10222,
      pubkey: PUBKEY,
      created_at: 1,
      content: '',
      tags: [['concord', 'b'.repeat(64)]]
    };
    const template = buildPointerUpdate(event, CID);
    expect(template.tags.filter((t) => t[0] === 'concord')).toEqual([['concord', CID]]);
  });
});

describe('founding idempotency marker', () => {
  it('round-trips write → read → clear, keyed per community pubkey', () => {
    const storage = fakeStorage();
    expect(readFoundingMarker(PUBKEY, storage)).toBeUndefined();

    writeFoundingMarker(PUBKEY, CID, storage);
    expect(readFoundingMarker(PUBKEY, storage)).toBe(CID);
    expect(storage.map.get(`concord:founding:${PUBKEY}`)).toBe(CID);
    // a different community's founding is independent
    expect(readFoundingMarker('b'.repeat(64), storage)).toBeUndefined();

    clearFoundingMarker(PUBKEY, storage);
    expect(readFoundingMarker(PUBKEY, storage)).toBeUndefined();
  });

  it('no-ops safely without storage (SSR/node) or without a pubkey', () => {
    // default storage in node = undefined localStorage — must not throw
    expect(readFoundingMarker(PUBKEY)).toBeUndefined();
    expect(() => writeFoundingMarker(PUBKEY, CID)).not.toThrow();
    expect(() => clearFoundingMarker(PUBKEY)).not.toThrow();

    const storage = fakeStorage();
    writeFoundingMarker('', CID, storage);
    expect(storage.map.size).toBe(0);
    expect(readFoundingMarker('', storage)).toBeUndefined();
  });

  it('swallows storage exceptions (quota / privacy mode)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      }
    };
    expect(readFoundingMarker(PUBKEY, throwing)).toBeUndefined();
    expect(() => writeFoundingMarker(PUBKEY, CID, throwing)).not.toThrow();
    expect(() => clearFoundingMarker(PUBKEY, throwing)).not.toThrow();
  });
});

describe('foundConcordArea idempotency', () => {
  /** @type {ReturnType<typeof fakeStorage>} */
  let storage;

  beforeEach(() => {
    storage = fakeStorage();
    // foundConcordArea uses the default (globalThis.localStorage) storage
    globalThis.localStorage = /** @type {any} */ (storage);
  });

  afterEach(() => {
    // @ts-expect-error node has no localStorage; restore that state
    delete globalThis.localStorage;
    mockState.client = null;
    mockState.publish = null;
  });

  function makeArgs() {
    return {
      communikeyEvent: { kind: 10222, pubkey: PUBKEY, created_at: 1, content: '', tags: [] },
      communityName: 'Test area',
      relays: ['wss://concord.example'],
      communitySigner: {
        signEvent: vi.fn(async (/** @type {any} */ t) => ({
          ...t,
          id: 'signed-id',
          sig: 'signed-sig',
          pubkey: PUBKEY
        }))
      }
    };
  }

  it('reuses the minted community on retry after a failed pointer publish (no duplicate)', async () => {
    const community = { communityId: CID };
    const createNewCommunity = vi.fn(async () => community);
    mockState.client = {
      createNewCommunity,
      getCommunity: (/** @type {string} */ id) => (id === CID ? community : undefined)
    };
    mockState.publish = vi
      .fn()
      .mockRejectedValueOnce(new Error('relay down'))
      .mockResolvedValue({ success: true });

    const args = makeArgs();
    // First attempt: community minted, pointer publish fails → marker persists.
    await expect(foundConcordArea(args)).rejects.toThrow('relay down');
    expect(createNewCommunity).toHaveBeenCalledTimes(1);
    expect(readFoundingMarker(PUBKEY, storage)).toBe(CID);

    // Retry: reuses the minted community, publishes the pointer, clears the marker.
    const result = await foundConcordArea(args);
    expect(createNewCommunity).toHaveBeenCalledTimes(1); // NOT called again
    expect(result.communityId).toBe(CID);
    expect(readFoundingMarker(PUBKEY, storage)).toBeUndefined();
  });

  it('mints fresh when the marker points at a community the client no longer knows', async () => {
    writeFoundingMarker(PUBKEY, 'd'.repeat(64), storage);
    const community = { communityId: CID };
    const createNewCommunity = vi.fn(async () => community);
    mockState.client = { createNewCommunity, getCommunity: () => undefined };
    mockState.publish = vi.fn().mockResolvedValue({ success: true });

    const result = await foundConcordArea(makeArgs());
    expect(createNewCommunity).toHaveBeenCalledTimes(1);
    expect(result.communityId).toBe(CID);
    expect(readFoundingMarker(PUBKEY, storage)).toBeUndefined();
  });
});
