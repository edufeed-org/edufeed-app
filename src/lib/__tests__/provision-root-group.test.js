/** @vitest-environment node */
// src/lib/__tests__/provision-root-group.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createGroupOnRelay = vi.fn();
const confirmGroupMetadata = vi.fn();
const confirmGroupAdmins = vi.fn();
const publishToGroupRelay = vi.fn();
vi.mock('$lib/groups/group-management.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    generateGroupId: () => 'fresh-id-16chars',
    createGroupOnRelay: (/** @type {any} */ args) => createGroupOnRelay(args),
    confirmGroupMetadata: (/** @type {any} */ ...args) => confirmGroupMetadata(...args),
    confirmGroupAdmins: (/** @type {any} */ ...args) => confirmGroupAdmins(...args),
    publishToGroupRelay: (/** @type {any} */ ...args) => publishToGroupRelay(...args)
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
  publishToGroupRelay.mockReset().mockResolvedValue({ kind: 9000 });
});

// The community pubkey must sit on the root group's 39001 as an admin:
// application copies are encrypted per reviewer (= 39001 admins), and roster
// put-user/remove-user must be signable while the community account is
// active. Without this seat the creator's own community can neither read
// join requests nor approve anyone (journey-test bugs #2/#3, 2026-08-14).
describe('provisionRootGroup — community admin seat', () => {
  const COMMUNITY_PK = 'c'.repeat(64);

  it('seats the community pubkey as a 39001 admin on fresh creation', async () => {
    await provisionRootGroup({
      relay: RELAY,
      name: 'x',
      user: USER,
      communityPubkey: COMMUNITY_PK
    });
    expect(publishToGroupRelay).toHaveBeenCalledOnce();
    const [, template, user] = publishToGroupRelay.mock.calls[0];
    expect(template.kind).toBe(9000);
    expect(template.tags).toEqual([
      ['h', 'fresh-id-16chars'],
      ['p', COMMUNITY_PK, 'admin']
    ]);
    expect(user).toBe(USER);
  });

  it('skips the seat when the community IS the creator (current-keypair flow)', async () => {
    await provisionRootGroup({
      relay: RELAY,
      name: 'x',
      user: USER,
      communityPubkey: USER.pubkey
    });
    expect(publishToGroupRelay).not.toHaveBeenCalled();
  });

  it('re-seats on the marker-reuse path (group may predate the seat)', async () => {
    confirmGroupMetadata.mockResolvedValue({ kind: 39000 });
    confirmGroupAdmins.mockResolvedValue(adminsEvent(USER.pubkey));
    await provisionRootGroup({
      relay: RELAY,
      name: 'x',
      user: USER,
      existingId: 'pending-id',
      communityPubkey: COMMUNITY_PK
    });
    expect(publishToGroupRelay).toHaveBeenCalledOnce();
    const [, template] = publishToGroupRelay.mock.calls[0];
    expect(template.tags).toEqual([
      ['h', 'pending-id'],
      ['p', COMMUNITY_PK, 'admin']
    ]);
  });

  it('propagates a failed seat (a community that cannot manage itself must not be created)', async () => {
    publishToGroupRelay.mockRejectedValue(new Error('blocked: nope'));
    await expect(
      provisionRootGroup({ relay: RELAY, name: 'x', user: USER, communityPubkey: COMMUNITY_PK })
    ).rejects.toThrow('blocked: nope');
  });
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

  it('seeds the community picture + about onto the root group metadata', async () => {
    // So the /c NIP-11 (synthesized from the root 39000) shows an icon +
    // description in Armada. metadataTags drops empties, so an absent
    // picture/about must not appear.
    await provisionRootGroup({
      relay: RELAY,
      name: 'Musterschule',
      about: 'Building for better education',
      picture: 'https://i.nostr.build/pic.jpg',
      user: USER
    });
    expect(createGroupOnRelay.mock.calls[0][0].metadata).toEqual({
      name: 'Musterschule',
      about: 'Building for better education',
      picture: 'https://i.nostr.build/pic.jpg',
      isPublic: true,
      isOpen: false
    });
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
