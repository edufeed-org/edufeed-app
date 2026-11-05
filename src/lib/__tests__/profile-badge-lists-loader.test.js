/**
 * Where a user's profile badges list (kind 10008, deprecated 30008
 * `profile_badges`) is looked for: the app's lookup relays AND the owner's
 * NIP-65 write relays.
 *
 * 2026-11-05: kaya accepted a badge in the inbox; the list went outbox-model
 * to her write relays and only nostr.mom kept it. The profile page asked the
 * lookup relays only, so every visitor saw "Keine Badges" while she saw the
 * badge from her own cache. Other clients (Amethyst) write the list to the
 * outbox only too.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';

const addressLoader = vi.hoisted(() => vi.fn());
const eventLoader = vi.hoisted(() => vi.fn());
const getWriteRelays = vi.hoisted(() => vi.fn());
const getReadRelays = vi.hoisted(() => vi.fn());
vi.mock('$lib/loaders/base.js', () => ({ addressLoader, eventLoader }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://lookup.example/', 'wss://shared.example/']
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({ getWriteRelays, getReadRelays }));

const { loadProfileBadgeLists, loadBadgeSlot } = await import('$lib/loaders/profile-badges.js');

const PK = 'a'.repeat(64);
const pointers = () => addressLoader.mock.calls.map((c) => c[0]);

describe('loadProfileBadgeLists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addressLoader.mockImplementation(() => of(undefined));
  });

  it("asks the lookup relays and the owner's write relays for both list kinds", async () => {
    getWriteRelays.mockResolvedValue(['wss://nostr.mom', 'wss://shared.example']);
    await new Promise((resolve, reject) =>
      loadProfileBadgeLists(PK).subscribe({ complete: () => resolve(undefined), error: reject })
    );

    expect(getWriteRelays).toHaveBeenCalledWith(PK);
    expect(pointers()).toEqual(
      expect.arrayContaining([
        { kind: 10008, pubkey: PK, relays: ['wss://lookup.example/', 'wss://shared.example/'] },
        {
          kind: 30008,
          pubkey: PK,
          identifier: 'profile_badges',
          relays: ['wss://lookup.example/', 'wss://shared.example/']
        },
        // only the write relay the lookup set does not already cover
        { kind: 10008, pubkey: PK, relays: ['wss://nostr.mom'] },
        { kind: 30008, pubkey: PK, identifier: 'profile_badges', relays: ['wss://nostr.mom'] }
      ])
    );
    expect(pointers()).toHaveLength(4);
    // 10008 is a plain replaceable: an identifier would poison the batched #d filter
    for (const p of pointers().filter((p) => p.kind === 10008)) {
      expect(p).not.toHaveProperty('identifier');
    }
  });

  it('still completes from the lookup relays when the relay list cannot be read', async () => {
    getWriteRelays.mockRejectedValue(new Error('no relay list'));
    await new Promise((resolve, reject) =>
      loadProfileBadgeLists(PK).subscribe({ complete: () => resolve(undefined), error: reject })
    );
    expect(pointers()).toHaveLength(2);
  });
});

describe('loadBadgeSlot', () => {
  const ISSUER = 'c'.repeat(64);
  const slot = { badgeAddress: `30009:${ISSUER}:bravery`, awardId: 'f'.repeat(64) };

  beforeEach(() => {
    vi.clearAllMocks();
    addressLoader.mockImplementation(() => of(undefined));
    eventLoader.mockImplementation(() => of(undefined));
  });

  // 2026-11-05, laoc's profile: seven accepted badges rendered as blank cards
  // dated 1 Jan 1970 — the definitions live on each issuer's own relays and
  // the slots carry no relay hints.
  it("asks the issuer's write relays and the owner's read relays besides the lookup relays", async () => {
    getWriteRelays.mockResolvedValue(['wss://issuer-out.example']);
    getReadRelays.mockResolvedValue(['wss://owner-in.example', 'wss://lookup.example/']);
    await new Promise((resolve, reject) =>
      loadBadgeSlot(slot, PK).subscribe({ complete: () => resolve(undefined), error: reject })
    );

    expect(getWriteRelays).toHaveBeenCalledWith(ISSUER);
    expect(getReadRelays).toHaveBeenCalledWith(PK);
    const defs = addressLoader.mock.calls.map((c) => c[0]);
    expect(defs).toEqual([
      {
        kind: 30009,
        pubkey: ISSUER,
        identifier: 'bravery',
        relays: ['wss://lookup.example/', 'wss://shared.example/']
      },
      {
        kind: 30009,
        pubkey: ISSUER,
        identifier: 'bravery',
        relays: ['wss://issuer-out.example', 'wss://owner-in.example']
      }
    ]);
    const awards = eventLoader.mock.calls.map((c) => c[0]);
    expect(awards).toEqual([
      { id: slot.awardId, relays: ['wss://lookup.example/', 'wss://shared.example/'] },
      { id: slot.awardId, relays: ['wss://issuer-out.example', 'wss://owner-in.example'] }
    ]);
  });

  it('skips a slot whose badge address is not a kind 30009 pointer', async () => {
    await new Promise((resolve) =>
      loadBadgeSlot({ badgeAddress: 'garbage', awardId: 'f'.repeat(64) }, PK).subscribe({
        complete: () => resolve(undefined)
      })
    );
    expect(addressLoader).not.toHaveBeenCalled();
  });
});
