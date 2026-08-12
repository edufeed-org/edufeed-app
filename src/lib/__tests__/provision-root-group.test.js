/** @vitest-environment node */
// src/lib/__tests__/provision-root-group.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createGroupOnRelay = vi.fn();
const confirmGroupMetadata = vi.fn();
const confirmGroupAdmins = vi.fn();
vi.mock('$lib/groups/group-management.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    generateGroupId: () => 'fresh-id-16chars',
    createGroupOnRelay: (/** @type {any} */ args) => createGroupOnRelay(args),
    confirmGroupMetadata: (/** @type {any} */ ...args) => confirmGroupMetadata(...args),
    confirmGroupAdmins: (/** @type {any} */ ...args) => confirmGroupAdmins(...args)
  };
});
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn(() => ({ mocked: true })) }
}));

const { provisionRootGroup, readRootGroupMarker, writeRootGroupMarker, clearRootGroupMarker } =
  await import('$lib/groups/provision-root-group.js');

const RELAY = 'wss://groups.example.com';
const USER = { pubkey: 'a'.repeat(64), signer: {} };

/** A kind-39001 admins event listing the given pubkey as an admin. */
const adminsEvent = (/** @type {string} */ pubkey) => ({ kind: 39001, tags: [['p', pubkey]] });

beforeEach(() => {
  createGroupOnRelay.mockReset().mockResolvedValue({ kind: 39000 });
  confirmGroupMetadata.mockReset();
  confirmGroupAdmins.mockReset();
});

describe('provisionRootGroup', () => {
  it('creates a fresh group with the fixed root metadata', async () => {
    const result = await provisionRootGroup({ relay: RELAY, name: 'Musterschule', user: USER });
    expect(result).toEqual({ id: 'fresh-id-16chars', relay: RELAY });
    expect(createGroupOnRelay).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'fresh-id-16chars',
        metadata: { name: 'Musterschule', isPublic: true, isOpen: false },
        user: USER
      })
    );
  });

  it('reuses a confirmed existing id when the user is a listed admin (idempotent re-run)', async () => {
    confirmGroupMetadata.mockResolvedValue({ kind: 39000 });
    confirmGroupAdmins.mockResolvedValue(adminsEvent(USER.pubkey));
    const result = await provisionRootGroup({
      relay: RELAY,
      name: 'x',
      user: USER,
      existingId: 'pending-id'
    });
    expect(result).toEqual({ id: 'pending-id', relay: RELAY });
    expect(createGroupOnRelay).not.toHaveBeenCalled();
  });

  it('creates fresh when the pending id is not confirmed on the relay', async () => {
    confirmGroupMetadata.mockResolvedValue(null);
    const result = await provisionRootGroup({
      relay: RELAY,
      name: 'x',
      user: USER,
      existingId: 'gone-id'
    });
    expect(result.id).toBe('fresh-id-16chars');
    expect(createGroupOnRelay).toHaveBeenCalledOnce();
  });

  it('creates fresh when the marker is confirmed but the user is NOT a listed admin (poisoned/stale marker)', async () => {
    confirmGroupMetadata.mockResolvedValue({ kind: 39000 });
    confirmGroupAdmins.mockResolvedValue(adminsEvent('b'.repeat(64)));
    const result = await provisionRootGroup({
      relay: RELAY,
      name: 'x',
      user: USER,
      existingId: 'foreign-id'
    });
    expect(result.id).toBe('fresh-id-16chars');
    expect(createGroupOnRelay).toHaveBeenCalledOnce();
  });

  it('creates fresh when the 39001 admin fetch is empty (fail safe)', async () => {
    confirmGroupMetadata.mockResolvedValue({ kind: 39000 });
    confirmGroupAdmins.mockResolvedValue(null);
    const result = await provisionRootGroup({
      relay: RELAY,
      name: 'x',
      user: USER,
      existingId: 'no-admins-id'
    });
    expect(result.id).toBe('fresh-id-16chars');
    expect(createGroupOnRelay).toHaveBeenCalledOnce();
  });

  it('creates fresh when the 39001 admin fetch throws/times out (fail safe, never throws itself)', async () => {
    confirmGroupMetadata.mockResolvedValue({ kind: 39000 });
    confirmGroupAdmins.mockRejectedValue(new Error('relay timeout'));
    const result = await provisionRootGroup({
      relay: RELAY,
      name: 'x',
      user: USER,
      existingId: 'timeout-id'
    });
    expect(result.id).toBe('fresh-id-16chars');
    expect(createGroupOnRelay).toHaveBeenCalledOnce();
  });

  it('propagates relay failures', async () => {
    createGroupOnRelay.mockRejectedValue(new Error('group not confirmed by relay'));
    await expect(provisionRootGroup({ relay: RELAY, name: 'x', user: USER })).rejects.toThrow(
      'group not confirmed by relay'
    );
  });
});

describe('root-group founding marker', () => {
  /** @type {Map<string, string>} */
  let map;
  const storage = {
    getItem: (/** @type {string} */ k) => map.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => void map.set(k, v),
    removeItem: (/** @type {string} */ k) => void map.delete(k)
  };
  beforeEach(() => {
    map = new Map();
  });

  it('write/read/clear round-trip, keyed by community pubkey', () => {
    expect(readRootGroupMarker('pk1', storage)).toBeNull();
    writeRootGroupMarker('pk1', 'gid1', storage);
    expect(readRootGroupMarker('pk1', storage)).toBe('gid1');
    expect(readRootGroupMarker('pk2', storage)).toBeNull();
    clearRootGroupMarker('pk1', storage);
    expect(readRootGroupMarker('pk1', storage)).toBeNull();
  });
});
