// @ts-nocheck
/** @vitest-environment node */
// What a claim, its acceptance and its withdrawal sign, and where they go.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';
import { addSeenRelay } from 'applesauce-core/helpers';

const PUBLISHER = 'a'.repeat(64);
const CLAIMANT = 'b'.repeat(64);
const SEEN = 'wss://seen.example/';
const AMB = 'wss://amb.example/';

const publishEvent = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent }));

const eventStore = vi.hoisted(() => ({ add: vi.fn(), getReplaceable: vi.fn() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore }));

const deleteEvent = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteEvent }));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getEducationalRelays: () => ['wss://amb.example/'],
  getArticleRelays: () => ['wss://articles.example/']
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPrimaryWriteRelay: async () => 'wss://claimant.example/'
}));

const { publishClaim, acceptClaim, withdrawClaim, claimRelays } = await import(
  '$lib/helpers/publishAttributionClaim.js'
);

/** @param {string} pubkey */
const userFor = (pubkey) => ({
  pubkey,
  signer: {
    signEvent: vi.fn(async (t) => ({ ...t, pubkey, id: 'id-' + pubkey.slice(0, 2), sig: 's' }))
  }
});

const resource = (tags = [['creator:name', 'Paula Gregorio']]) => {
  const event = {
    kind: 30142,
    id: '1'.repeat(64),
    pubkey: PUBLISHER,
    created_at: 500,
    content: 'body',
    tags: [['d', 'res'], ['name', 'Titel'], ...tags]
  };
  addSeenRelay(event, SEEN);
  return event;
};
const claimEvent = (name = 'Paula Gregorio') => ({
  kind: 1985,
  id: '2'.repeat(64),
  pubkey: CLAIMANT,
  created_at: 600,
  content: '',
  tags: [
    ['L', 'org.edufeed.attribution'],
    ['l', 'creator', 'org.edufeed.attribution'],
    ['a', `30142:${PUBLISHER}:res`, SEEN],
    ['p', PUBLISHER, SEEN],
    ['name', name]
  ]
});

beforeEach(() => {
  vi.clearAllMocks();
  publishEvent.mockResolvedValue({ success: true });
  deleteEvent.mockResolvedValue({ success: true });
  eventStore.getReplaceable.mockReturnValue(undefined);
});

describe('claimRelays', () => {
  it('is the relays of the content kind plus the relays the content was seen on', () => {
    expect(claimRelays(resource())).toEqual([AMB, SEEN]);
    expect(claimRelays({ kind: 30023, pubkey: PUBLISHER, tags: [] })).toEqual([
      'wss://articles.example/'
    ]);
  });
});

describe('publishClaim', () => {
  it('signs the claim as the active user and sends it to the publisher and the content relays', async () => {
    const user = userFor(CLAIMANT);
    const signed = await publishClaim(
      resource(),
      { role: 'creator', name: 'Paula Gregorio' },
      user
    );

    expect(signed.kind).toBe(1985);
    expect(signed.pubkey).toBe(CLAIMANT);
    expect(signed.tags).toEqual(claimEvent().tags);
    expect(publishEvent).toHaveBeenCalledWith(signed, [PUBLISHER], {
      additionalRelays: [AMB, SEEN]
    });
    expect(eventStore.add).toHaveBeenCalledWith(signed);
  });

  it('throws and stores nothing when no relay accepted the claim', async () => {
    publishEvent.mockResolvedValue({ success: false });
    await expect(
      publishClaim(resource(), { role: 'creator', name: 'Paula Gregorio' }, userFor(CLAIMANT))
    ).rejects.toThrow();
    expect(eventStore.add).not.toHaveBeenCalled();
  });
});

describe('acceptClaim', () => {
  it('re-publishes the same event with the id and the companion p tag', async () => {
    const user = userFor(PUBLISHER);
    const event = resource();
    const signed = await acceptClaim(event, claimEvent(), user);

    expect(signed.kind).toBe(30142);
    expect(signed.content).toBe('body');
    expect(signed.created_at).toBeGreaterThan(event.created_at);
    expect(signed.tags).toEqual([
      ['d', 'res'],
      ['name', 'Titel'],
      ['creator:name', 'Paula Gregorio'],
      ['creator:id', `nostr:${nip19.npubEncode(CLAIMANT)}`],
      ['p', CLAIMANT, 'wss://claimant.example/', 'creator']
    ]);
    expect(publishEvent).toHaveBeenCalledWith(signed, [CLAIMANT], { additionalRelays: [SEEN] });
    expect(eventStore.add).toHaveBeenCalledWith(signed);
  });

  it('accepts onto the latest version the store holds, not a stale copy', async () => {
    const newer = { ...resource(), created_at: 900, tags: [...resource().tags, ['t', 'neu']] };
    eventStore.getReplaceable.mockReturnValue(newer);
    const signed = await acceptClaim(resource(), claimEvent(), userFor(PUBLISHER));
    expect(eventStore.getReplaceable).toHaveBeenCalledWith(30142, PUBLISHER, 'res');
    expect(signed.tags).toContainEqual(['t', 'neu']);
    expect(signed.created_at).toBeGreaterThan(900);
  });

  it('refuses a signer who is not the publisher', async () => {
    const user = userFor(CLAIMANT);
    await expect(acceptClaim(resource(), claimEvent(), user)).rejects.toThrow();
    expect(user.signer.signEvent).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('refuses a claim that is not open', async () => {
    const user = userFor(PUBLISHER);
    // outdated: no such name-only credit
    await expect(acceptClaim(resource(), claimEvent('Jemand Anderes'), user)).rejects.toThrow();
    // accepted already
    const accepted = resource([
      ['creator:name', 'Paula Gregorio'],
      ['p', CLAIMANT, '', 'creator']
    ]);
    await expect(acceptClaim(accepted, claimEvent(), user)).rejects.toThrow();
    // not a claim at all
    await expect(
      acceptClaim(resource(), { kind: 1, pubkey: CLAIMANT, tags: [] }, user)
    ).rejects.toThrow();
    expect(user.signer.signEvent).not.toHaveBeenCalled();
  });
});

describe('withdrawClaim', () => {
  it('deletes the claim on the relays it was published to', async () => {
    const user = userFor(CLAIMANT);
    const claim = claimEvent();
    await withdrawClaim(claim, user, resource());
    expect(deleteEvent).toHaveBeenCalledWith(claim, user, { additionalRelays: [AMB, SEEN] });
  });

  it('throws when the deletion failed', async () => {
    deleteEvent.mockResolvedValue({ success: false, error: 'nope' });
    await expect(withdrawClaim(claimEvent(), userFor(CLAIMANT), resource())).rejects.toThrow(
      'nope'
    );
  });
});
