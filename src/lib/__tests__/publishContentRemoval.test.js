// @ts-nocheck
/** @vitest-environment node */
// src/lib/__tests__/publishContentRemoval.test.js
//
// Who signs a removal, where it goes, and how it is undone.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const COMMUNITY = 'a'.repeat(64);
const ADMIN = 'b'.repeat(64);
const AUTHOR = 'e'.repeat(64);
const GROUPS_RELAY = 'wss://groups.example/';
const COMMUNITY_RELAY = 'wss://community.example/';

const signers = vi.hoisted(() => ({
  /** @type {Record<string, any>} */
  byPubkey: {}
}));
vi.mock('$lib/helpers/community-signer.js', () => ({
  getCommunitySigner: (/** @type {string} */ pk) => signers.byPubkey[pk] ?? null
}));

const publishEvent = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent }));

const eventStore = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore }));

const deleteEvent = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteEvent }));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://communikey.example/']
}));

const { removeFromCommunity, restoreToCommunity, pickRemovalSigner } = await import(
  '$lib/helpers/publishContentRemoval.js'
);

/** @param {string} pubkey */
const signerFor = (pubkey) => ({
  signEvent: vi.fn(async (/** @type {any} */ t) => ({
    ...t,
    pubkey,
    id: 'id-' + pubkey.slice(0, 2),
    sig: 's'
  }))
});

const moderatedCommunity = {
  kind: 10222,
  pubkey: COMMUNITY,
  created_at: 1000,
  content: '',
  tags: [
    ['membership', 'root1', GROUPS_RELAY],
    ['r', COMMUNITY_RELAY],
    ['content', 'Articles'],
    ['k', '30023']
  ]
};
const openCommunity = {
  ...moderatedCommunity,
  tags: moderatedCommunity.tags.filter((t) => t[0] !== 'membership')
};
const admins = [{ pubkey: ADMIN, roles: ['admin'] }];
const article = {
  kind: 30023,
  id: '1'.repeat(64),
  pubkey: AUTHOR,
  created_at: 500,
  content: '',
  tags: [['d', 'my-article']]
};

beforeEach(() => {
  vi.clearAllMocks();
  signers.byPubkey = {};
});

describe('pickRemovalSigner', () => {
  it("prefers the moderator's own key on a moderated community (audit trail, revocable by demotion)", () => {
    const activeUser = { pubkey: ADMIN, signer: signerFor(ADMIN) };
    signers.byPubkey[COMMUNITY] = signerFor(COMMUNITY);
    const picked = pickRemovalSigner({ communityEvent: moderatedCommunity, admins, activeUser });
    expect(picked?.pubkey).toBe(ADMIN);
  });

  it('falls back to the community key when the viewer holds it', () => {
    const activeUser = { pubkey: 'c'.repeat(64), signer: signerFor('c'.repeat(64)) };
    signers.byPubkey[COMMUNITY] = signerFor(COMMUNITY);
    const picked = pickRemovalSigner({ communityEvent: openCommunity, admins, activeUser });
    expect(picked?.pubkey).toBe(COMMUNITY);
  });

  it('is null for a publisher-only or logged-out viewer without the key', () => {
    const activeUser = { pubkey: ADMIN, signer: signerFor(ADMIN) };
    expect(
      pickRemovalSigner({
        communityEvent: moderatedCommunity,
        admins: [{ pubkey: ADMIN, roles: ['publisher'] }],
        activeUser
      })
    ).toBeNull();
    expect(pickRemovalSigner({ communityEvent: openCommunity, admins, activeUser })).toBeNull();
    expect(
      pickRemovalSigner({ communityEvent: openCommunity, admins, activeUser: null })
    ).toBeNull();
  });
});

describe('removeFromCommunity', () => {
  it('signs a 1985 label, publishes it to the community + communikey relays and adds it to the store', async () => {
    const activeUser = { pubkey: ADMIN, signer: signerFor(ADMIN) };
    const signed = await removeFromCommunity(article, moderatedCommunity, { admins, activeUser });

    expect(signed.kind).toBe(1985);
    expect(signed.pubkey).toBe(ADMIN);
    expect(signed.created_at).toBeGreaterThan(0);
    expect(signed.tags).toContainEqual(['h', COMMUNITY]);
    expect(signed.tags).toContainEqual(['a', `30023:${AUTHOR}:my-article`, COMMUNITY_RELAY]);

    expect(publishEvent).toHaveBeenCalledTimes(1);
    const [published, tagged, opts] = publishEvent.mock.calls[0];
    expect(published).toBe(signed);
    expect(tagged).toEqual([]);
    expect(opts.additionalRelays).toEqual([COMMUNITY_RELAY, 'wss://communikey.example/']);
    expect(eventStore.add).toHaveBeenCalledWith(signed);
  });

  it('signs with the community key when no own authority exists', async () => {
    signers.byPubkey[COMMUNITY] = signerFor(COMMUNITY);
    const activeUser = { pubkey: 'c'.repeat(64), signer: signerFor('c'.repeat(64)) };
    const signed = await removeFromCommunity(article, openCommunity, { admins: [], activeUser });
    expect(signed.pubkey).toBe(COMMUNITY);
  });

  it('refuses without authority and publishes nothing', async () => {
    const activeUser = { pubkey: 'c'.repeat(64), signer: signerFor('c'.repeat(64)) };
    await expect(
      removeFromCommunity(article, openCommunity, { admins: [], activeUser })
    ).rejects.toThrow(/not allowed/i);
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

describe('restoreToCommunity', () => {
  const label = {
    kind: 1985,
    id: '9'.repeat(64),
    pubkey: ADMIN,
    created_at: 2000,
    content: '',
    tags: [['h', COMMUNITY]]
  };

  it('deletes the label with the signer of ITS author, to the community relays too', async () => {
    const signer = signerFor(ADMIN);
    signers.byPubkey[ADMIN] = signer;
    await restoreToCommunity(label, moderatedCommunity);
    expect(deleteEvent).toHaveBeenCalledTimes(1);
    const [target, account, opts] = deleteEvent.mock.calls[0];
    expect(target).toBe(label);
    expect(account).toEqual({ pubkey: ADMIN, signer });
    expect(opts.additionalRelays).toEqual([COMMUNITY_RELAY, 'wss://communikey.example/']);
  });

  it("throws when the label's author key is not available here", async () => {
    await expect(restoreToCommunity(label, moderatedCommunity)).rejects.toThrow(/not available/i);
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it('surfaces a failed deletion', async () => {
    signers.byPubkey[ADMIN] = signerFor(ADMIN);
    deleteEvent.mockResolvedValueOnce({ success: false, error: 'boom' });
    await expect(restoreToCommunity(label, moderatedCommunity)).rejects.toThrow('boom');
  });
});

describe('canRestoreRemoval', () => {
  it("is true only when the label author's signer is present", async () => {
    const { canRestoreRemoval } = await import('$lib/helpers/publishContentRemoval.js');
    expect(canRestoreRemoval({ pubkey: ADMIN })).toBe(false);
    signers.byPubkey[ADMIN] = signerFor(ADMIN);
    expect(canRestoreRemoval({ pubkey: ADMIN })).toBe(true);
  });
});
