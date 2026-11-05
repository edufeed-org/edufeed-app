/**
 * AcceptBadgeAward (NIP-58): adds an awarded badge to the user's profile
 * badges list (kind 10008, with the deprecated kind 30008 `profile_badges`
 * list folded in) and publishes it outbox-model.
 *
 * Same fake action context as list-actions.test.js: the app event factory is
 * injected through a module mock, the loaders are stubbed to complete at once.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const factoryRef = vi.hoisted(() => ({ current: /** @type {any} */ (null) }));
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => factoryRef.current
}));

const addressLoader = vi.hoisted(() =>
  vi.fn(() => ({
    subscribe: (/** @type {any} */ observer) => (observer?.complete?.(), { unsubscribe() {} })
  }))
);
vi.mock('$lib/loaders/base.js', () => ({ addressLoader }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://lookup.example/']
}));

import { AcceptBadgeAward } from '../actions/badge-actions.js';

const USER = 'b'.repeat(64);
const ISSUER = 'a'.repeat(64);
const BADGE = `30009:${ISSUER}:bravery`;
const AWARD_ID = 'f'.repeat(64);

const award = {
  id: AWARD_ID,
  kind: 8,
  pubkey: ISSUER,
  created_at: 100,
  content: '',
  sig: '',
  tags: [
    ['a', BADGE],
    ['p', USER]
  ]
};

/** @param {{ modern?: any, legacy?: any, outboxes?: string[], pubkey?: string }} [opts] */
function createContext({ modern, legacy, outboxes = ['wss://out.example'], pubkey = USER } = {}) {
  const published = /** @type {any[]} */ ([]);

  const publish = vi.fn(async (/** @type {any} */ evt, /** @type {string[]=} */ relays) => {
    published.push({ event: evt, relays });
  });
  const sign = vi.fn(async (/** @type {any} */ draft) => ({
    ...draft,
    id: 'signed',
    pubkey,
    sig: 'sig'
  }));

  /** @param {any} base @param {any[]} eventOps */
  async function runOps(base, eventOps) {
    let tags = [...(base.tags ?? [])];
    let content = base.content ?? '';
    for (const op of eventOps) {
      if (!op) continue;
      const result = await op({ ...base, tags, content }, { signer: undefined });
      tags = result.tags;
      content = result.content ?? content;
    }
    return { kind: base.kind, tags, content, created_at: 111 };
  }
  const factory = {
    modify: vi.fn((/** @type {any} */ evt, ...eventOps) => runOps(evt, eventOps)),
    build: vi.fn((/** @type {any} */ template, ...eventOps) => runOps(template, eventOps))
  };
  factoryRef.current = factory;

  const user = {
    pubkey,
    replaceable: vi.fn((/** @type {number} */ kind) => ({
      $first: vi.fn(async () => (kind === 10008 ? modern : kind === 30008 ? legacy : undefined))
    })),
    outboxes$: { $first: vi.fn(async () => outboxes) }
  };

  return /** @type {any} */ ({ user, publish, sign, factory, published });
}

/** @param {any} event */
const pairs = (event) =>
  event.tags.filter((/** @type {string[]} */ t) => t[0] === 'a' || t[0] === 'e');

describe('AcceptBadgeAward', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an event that is not a badge award', async () => {
    const ctx = createContext();
    await expect(
      AcceptBadgeAward(/** @type {any} */ ({ ...award, kind: 1 }))(ctx)
    ).rejects.toThrow();
    expect(ctx.publish).not.toHaveBeenCalled();
  });

  it('rejects an award that does not name the user', async () => {
    const ctx = createContext({ pubkey: 'c'.repeat(64) });
    await expect(AcceptBadgeAward(/** @type {any} */ (award))(ctx)).rejects.toThrow();
    expect(ctx.publish).not.toHaveBeenCalled();
  });

  it('creates a kind 10008 list with the a/e pair when the user has none', async () => {
    const ctx = createContext();
    await AcceptBadgeAward(/** @type {any} */ (award))(ctx);

    expect(ctx.factory.build).toHaveBeenCalled();
    expect(ctx.published).toHaveLength(1);
    const { event, relays } = ctx.published[0];
    expect(event.kind).toBe(10008);
    expect(pairs(event)).toEqual([
      ['a', BADGE],
      ['e', AWARD_ID]
    ]);
    expect(relays).toEqual(['wss://out.example']);
  });

  it('loads both profile-badges kinds from the lookup relays before deciding', async () => {
    const ctx = createContext();
    await AcceptBadgeAward(/** @type {any} */ (award))(ctx);

    const pointers = /** @type {any[][]} */ (addressLoader.mock.calls).map((call) => call[0]);
    expect(pointers).toEqual(
      expect.arrayContaining([
        { kind: 10008, pubkey: USER, relays: ['wss://lookup.example/'] },
        {
          kind: 30008,
          pubkey: USER,
          identifier: 'profile_badges',
          relays: ['wss://lookup.example/']
        }
      ])
    );
    // 10008 is a plain replaceable: no identifier (it would poison the batched #d filter)
    expect(pointers.find((p) => p.kind === 10008)).not.toHaveProperty('identifier');
  });

  it('appends to an existing kind 10008 list, keeping its slots', async () => {
    const other = `30009:${ISSUER}:honor`;
    const modern = {
      kind: 10008,
      pubkey: USER,
      created_at: 50,
      content: '',
      tags: [
        ['a', other],
        ['e', '1'.repeat(64)]
      ]
    };
    const ctx = createContext({ modern });
    await AcceptBadgeAward(/** @type {any} */ (award))(ctx);

    expect(ctx.factory.modify).toHaveBeenCalledWith(modern, expect.anything());
    const { event } = ctx.published[0];
    expect(event.kind).toBe(10008);
    expect(pairs(event)).toEqual([
      ['a', other],
      ['e', '1'.repeat(64)],
      ['a', BADGE],
      ['e', AWARD_ID]
    ]);
  });

  it('migrates a deprecated kind 30008 list into the new kind 10008', async () => {
    const other = `30009:${ISSUER}:honor`;
    const legacy = {
      kind: 30008,
      pubkey: USER,
      created_at: 50,
      content: '',
      tags: [
        ['d', 'profile_badges'],
        ['a', other],
        ['e', '1'.repeat(64)]
      ]
    };
    const ctx = createContext({ legacy });
    await AcceptBadgeAward(/** @type {any} */ (award))(ctx);

    const { event } = ctx.published[0];
    expect(event.kind).toBe(10008);
    expect(event.tags.find((/** @type {string[]} */ t) => t[0] === 'd')).toBeUndefined();
    expect(pairs(event)).toEqual([
      ['a', other],
      ['e', '1'.repeat(64)],
      ['a', BADGE],
      ['e', AWARD_ID]
    ]);
  });

  it('keeps slots only the legacy list still has when both lists exist', async () => {
    const shared = `30009:${ISSUER}:honor`;
    const legacyOnly = `30009:${ISSUER}:kindness`;
    const modern = {
      kind: 10008,
      pubkey: USER,
      created_at: 60,
      content: '',
      tags: [
        ['a', shared],
        ['e', '1'.repeat(64)]
      ]
    };
    const legacy = {
      kind: 30008,
      pubkey: USER,
      created_at: 50,
      content: '',
      tags: [
        ['d', 'profile_badges'],
        ['a', shared],
        ['e', '1'.repeat(64)],
        ['a', legacyOnly],
        ['e', '2'.repeat(64)]
      ]
    };
    const ctx = createContext({ modern, legacy });
    await AcceptBadgeAward(/** @type {any} */ (award))(ctx);

    const { event } = ctx.published[0];
    expect(pairs(event)).toEqual([
      ['a', shared],
      ['e', '1'.repeat(64)],
      ['a', legacyOnly],
      ['e', '2'.repeat(64)],
      ['a', BADGE],
      ['e', AWARD_ID]
    ]);
  });

  it('replaces the slot when the same badge was already accepted', async () => {
    const modern = {
      kind: 10008,
      pubkey: USER,
      created_at: 50,
      content: '',
      tags: [
        ['a', BADGE],
        ['e', '1'.repeat(64)]
      ]
    };
    const ctx = createContext({ modern });
    await AcceptBadgeAward(/** @type {any} */ (award))(ctx);

    const { event } = ctx.published[0];
    expect(pairs(event)).toEqual([
      ['a', BADGE],
      ['e', AWARD_ID]
    ]);
  });
});
