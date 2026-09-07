// @ts-nocheck
/**
 * publish-service ↔ persistent outbox wiring (issue fd042051)
 *
 * Both outbox-model publish paths must hand the signed event to the outbox
 * BEFORE the first await (relay-list lookups can take seconds — long enough
 * for a tab to close), record the computed relay set, and clear each relay
 * on a definitive answer. Only a relay that never answered stays pending.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Call log shared by the mocks so ordering can be asserted. */
let calls = [];
const relayMocks = new Map();
let poolPublish = vi.fn();
let outboxRelays = [];

vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  pool: {
    relay: (url) => relayMocks.get(url),
    publish: (...args) => poolPublish(...args)
  },
  eventStore: {
    add: vi.fn(),
    remove: vi.fn(),
    getReplaceable: vi.fn(() => undefined)
  }
}));
vi.mock('$lib/stores/event-cache.svelte.js', () => ({
  uncacheEvent: vi.fn(async () => {}),
  recacheEvent: vi.fn(async () => {})
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPublishRelays: vi.fn(async () => {
    calls.push('getPublishRelays');
    return outboxRelays;
  }),
  getPrimaryWriteRelay: vi.fn(() => null)
}));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => []),
  kindToAppRelayCategory: vi.fn(() => null)
}));
vi.mock('$lib/helpers/communityRelays.js', () => ({
  getRelaysForKind: vi.fn(() => []),
  getCommunityGlobalRelays: vi.fn(() => []),
  getCommunityRelaysByEnforcement: vi.fn(() => ({ enforced: [], optional: [] }))
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getFallbackRelays: vi.fn(() => ['wss://fallback/'])
}));
vi.mock('$lib/services/publish-outbox.js', () => ({
  enqueue: vi.fn(async (entry) => {
    calls.push(`enqueue:${entry.event.id.slice(0, 2)}`);
  }),
  setPendingRelays: vi.fn(async (id, relays) => {
    calls.push(`pending:${id.slice(0, 2)}:${relays.join(',')}`);
  }),
  markRelayDone: vi.fn(async (id, relay) => {
    calls.push(`done:${id.slice(0, 2)}:${relay}`);
  }),
  replayOutbox: vi.fn(async () => ({ replayed: 0, delivered: 0, dropped: 0 }))
}));

import { publishEvent, publishEventOptimistic } from '$lib/services/publish-service.js';
import { enqueue, setPendingRelays, markRelayDone } from '$lib/services/publish-outbox.js';

const EVENT = {
  id: 'e1'.repeat(32),
  kind: 1063,
  pubkey: 'a'.repeat(64),
  tags: [],
  sig: '',
  content: ''
};
const COMPANION = { ...EVENT, id: 'c1'.repeat(32), kind: 1063 };

const ok = (url) => ({ publish: vi.fn(async () => ({ ok: true, from: url })) });
const rejects = (url) => ({
  publish: vi.fn(async () => ({ ok: false, from: url, message: 'blocked: no' }))
});
const dead = () => ({
  publish: vi.fn(async () => {
    throw new Error('timeout');
  })
});

const flush = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  relayMocks.clear();
  poolPublish = vi.fn(async () => []);
  outboxRelays = [];
});

describe('publishEventOptimistic outbox wiring', () => {
  it('enqueues before the relay lookup, records the relay set, clears answered relays', async () => {
    outboxRelays = ['wss://ok/', 'wss://rejects/', 'wss://dead/'];
    relayMocks.set('wss://ok/', ok('wss://ok/'));
    relayMocks.set('wss://rejects/', rejects('wss://rejects/'));
    relayMocks.set('wss://dead/', dead());

    const statuses = [];
    publishEventOptimistic(EVENT, ['p1'], {
      additionalRelays: [],
      onStatusChange: (s) => statuses.push({ ...s })
    });
    await flush();

    expect(calls.indexOf('enqueue:e1')).toBeLessThan(calls.indexOf('getPublishRelays'));
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ event: EVENT, taggedPubkeys: ['p1'] })
    );
    expect(setPendingRelays).toHaveBeenCalledWith(EVENT.id, [
      'wss://ok/',
      'wss://rejects/',
      'wss://dead/'
    ]);
    expect(markRelayDone).toHaveBeenCalledWith(EVENT.id, 'wss://ok/');
    expect(markRelayDone).toHaveBeenCalledWith(EVENT.id, 'wss://rejects/');
    expect(markRelayDone).not.toHaveBeenCalledWith(EVENT.id, 'wss://dead/');
    expect(statuses.at(-1)).toMatchObject({ status: 'success', successCount: 1 });
  });

  it('flags a total transport failure as queued for retry', async () => {
    outboxRelays = ['wss://dead/'];
    relayMocks.set('wss://dead/', dead());

    const statuses = [];
    publishEventOptimistic(EVENT, [], { onStatusChange: (s) => statuses.push({ ...s }) });
    await flush();

    expect(statuses.at(-1)).toMatchObject({ status: 'failed', retryQueued: true });
    expect(markRelayDone).not.toHaveBeenCalled();
  });

  it('does not flag a total rejection as queued — a relay decision is final', async () => {
    outboxRelays = ['wss://rejects/'];
    relayMocks.set('wss://rejects/', rejects('wss://rejects/'));

    const statuses = [];
    publishEventOptimistic(EVENT, [], { onStatusChange: (s) => statuses.push({ ...s }) });
    await flush();

    expect(statuses.at(-1)).toMatchObject({ status: 'failed', retryQueued: false });
    expect(markRelayDone).toHaveBeenCalledWith(EVENT.id, 'wss://rejects/');
  });

  it('falls back to the deployment relays when the computed set is empty', async () => {
    relayMocks.set('wss://fallback/', ok('wss://fallback/'));

    const statuses = [];
    publishEventOptimistic(EVENT, [], { onStatusChange: (s) => statuses.push({ ...s }) });
    await flush();

    expect(setPendingRelays).toHaveBeenCalledWith(EVENT.id, ['wss://fallback/']);
    expect(statuses.at(-1)).toMatchObject({ status: 'success', successCount: 1 });
  });

  it('publishes companions to the same relay set through the outbox', async () => {
    outboxRelays = ['wss://ok/', 'wss://dead/'];
    relayMocks.set('wss://ok/', ok('wss://ok/'));
    relayMocks.set('wss://dead/', dead());
    poolPublish = vi.fn(async () => [
      { ok: true, from: 'wss://ok/' },
      { ok: false, from: 'wss://dead/', message: 'timeout' }
    ]);

    publishEventOptimistic(EVENT, [], { companions: [COMPANION] });
    await flush();

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ event: COMPANION, pending: ['wss://ok/', 'wss://dead/'] })
    );
    expect(poolPublish).toHaveBeenCalledWith(
      ['wss://ok/', 'wss://dead/'],
      COMPANION,
      expect.anything()
    );
    expect(markRelayDone).toHaveBeenCalledWith(COMPANION.id, 'wss://ok/');
    // pool.publish folds transport errors into ok:false with no way to tell
    // them from rejections, so a companion's relay is only cleared on ok:true.
    expect(markRelayDone).not.toHaveBeenCalledWith(COMPANION.id, 'wss://dead/');
  });
});

describe('publishEvent outbox wiring', () => {
  it('enqueues before the relay lookup and clears answered relays', async () => {
    outboxRelays = ['wss://ok/', 'wss://dead/'];
    relayMocks.set('wss://ok/', ok('wss://ok/'));
    relayMocks.set('wss://dead/', dead());

    const result = await publishEvent(EVENT, []);

    expect(calls.indexOf('enqueue:e1')).toBeLessThan(calls.indexOf('getPublishRelays'));
    expect(setPendingRelays).toHaveBeenCalledWith(EVENT.id, ['wss://ok/', 'wss://dead/']);
    expect(markRelayDone).toHaveBeenCalledWith(EVENT.id, 'wss://ok/');
    expect(markRelayDone).not.toHaveBeenCalledWith(EVENT.id, 'wss://dead/');
    expect(result).toMatchObject({ success: true, successCount: 1 });
  });
});
