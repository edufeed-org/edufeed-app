// @ts-nocheck
/**
 * Persistent publish outbox (issue fd042051)
 *
 * A signed event that left the EventStore but never reached a relay is gone
 * once the tab closes. The outbox persists every outbox-model publish to IDB
 * BEFORE the relay round trip, clears each relay on a definitive answer, and
 * replays whatever is still pending on the next boot.
 *
 * @vitest-environment node
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enqueue,
  setPendingRelays,
  markRelayDone,
  listEntries,
  removeEntry,
  replayOutbox,
  deleteOutboxDb,
  OUTBOX_MAX_AGE_MS,
  OUTBOX_MAX_ATTEMPTS
} from '$lib/services/publish-outbox.js';

const ev = (id, kind = 1063) => ({
  id: id.repeat(64).slice(0, 64),
  kind,
  pubkey: 'a'.repeat(64),
  created_at: 100,
  tags: [],
  content: '',
  sig: 's'
});

beforeEach(async () => {
  await deleteOutboxDb();
});

describe('outbox storage', () => {
  it('enqueue stores the event with its publish inputs and null pending relays', async () => {
    const event = ev('1');
    await enqueue({ event, taggedPubkeys: ['p1'], additionalRelays: ['wss://x/'] });

    const entries = await listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: event.id,
      event,
      taggedPubkeys: ['p1'],
      additionalRelays: ['wss://x/'],
      pending: null,
      attempts: 0
    });
    expect(typeof entries[0].createdAt).toBe('number');
  });

  it('skips ephemeral kinds — nothing to replay later', async () => {
    await enqueue({ event: ev('2', 20001) });
    expect(await listEntries()).toHaveLength(0);
  });

  it('setPendingRelays records the computed relay set', async () => {
    const event = ev('3');
    await enqueue({ event });
    await setPendingRelays(event.id, ['wss://a/', 'wss://b/']);

    const [entry] = await listEntries();
    expect(entry.pending).toEqual(['wss://a/', 'wss://b/']);
  });

  it('markRelayDone drops the relay and deletes the entry once none are pending', async () => {
    const event = ev('4');
    await enqueue({ event });
    await setPendingRelays(event.id, ['wss://a/', 'wss://b/']);

    await markRelayDone(event.id, 'wss://a/');
    expect((await listEntries())[0].pending).toEqual(['wss://b/']);

    await markRelayDone(event.id, 'wss://b/');
    expect(await listEntries()).toHaveLength(0);
  });

  it('preserves write order when calls are not awaited', async () => {
    const event = ev('5');
    // Fire-and-forget, like the publish path does — the serial queue must
    // apply these in call order, not in whatever order IDB settles them.
    enqueue({ event });
    setPendingRelays(event.id, ['wss://a/', 'wss://b/']);
    markRelayDone(event.id, 'wss://a/');
    await removeEntry('nonexistent'); // flushes the chain

    const [entry] = await listEntries();
    expect(entry.pending).toEqual(['wss://b/']);
  });

  it('matches relays by normalized URL — the pool reports a trailing slash', async () => {
    const event = ev('c');
    await enqueue({ event });
    await setPendingRelays(event.id, ['wss://Relay.Example', 'wss://b.example/']);

    await markRelayDone(event.id, 'wss://relay.example/');
    expect((await listEntries())[0].pending).toEqual(['wss://b.example/']);
  });

  it('markRelayDone on an unknown entry is a no-op', async () => {
    await expect(markRelayDone('nope', 'wss://a/')).resolves.toBeUndefined();
  });
});

describe('replayOutbox', () => {
  it('publishes pending entries to their pending relays and clears definitive answers', async () => {
    const event = ev('6');
    await enqueue({ event });
    await setPendingRelays(event.id, ['wss://ok/', 'wss://rejects/', 'wss://dead/']);

    const publish = vi.fn(async () => [
      { ok: true, from: 'wss://ok/' },
      { ok: false, from: 'wss://rejects/', message: 'blocked: no' }
      // wss://dead/ timed out — no response at all
    ]);
    const onDelivered = vi.fn();

    const summary = await replayOutbox({ publish, onDelivered });

    expect(publish).toHaveBeenCalledWith(event, ['wss://ok/', 'wss://rejects/', 'wss://dead/']);
    expect(onDelivered).toHaveBeenCalledWith(event);
    const [entry] = await listEntries();
    expect(entry.pending).toEqual(['wss://dead/']);
    expect(entry.attempts).toBe(1);
    expect(summary).toEqual({ replayed: 1, delivered: 1, dropped: 0 });
  });

  it('computes the relay set for entries that never got one', async () => {
    const event = ev('7');
    await enqueue({ event, taggedPubkeys: ['p1'] });

    const computeRelays = vi.fn(async () => ['wss://computed/']);
    const publish = vi.fn(async () => [{ ok: true, from: 'wss://computed/' }]);

    await replayOutbox({ publish, computeRelays });

    expect(computeRelays).toHaveBeenCalledWith(expect.objectContaining({ id: event.id }));
    expect(publish).toHaveBeenCalledWith(event, ['wss://computed/']);
    expect(await listEntries()).toHaveLength(0);
  });

  it('leaves the entry untouched when the publish itself throws', async () => {
    const event = ev('8');
    await enqueue({ event });
    await setPendingRelays(event.id, ['wss://a/']);

    const publish = vi.fn(async () => {
      throw new Error('offline');
    });
    const summary = await replayOutbox({ publish });

    const [entry] = await listEntries();
    expect(entry.pending).toEqual(['wss://a/']);
    expect(summary).toEqual({ replayed: 1, delivered: 0, dropped: 0 });
  });

  it('drops entries older than the max age without publishing', async () => {
    const event = ev('9');
    await enqueue({ event });
    const publish = vi.fn();

    const summary = await replayOutbox({
      publish,
      now: Date.now() + OUTBOX_MAX_AGE_MS + 1
    });

    expect(publish).not.toHaveBeenCalled();
    expect(await listEntries()).toHaveLength(0);
    expect(summary).toEqual({ replayed: 0, delivered: 0, dropped: 1 });
  });

  it('drops entries that exhausted their attempts', async () => {
    const event = ev('a');
    await enqueue({ event });
    await setPendingRelays(event.id, ['wss://dead/']);
    const publish = vi.fn(async () => []);

    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) await replayOutbox({ publish });
    expect(publish).toHaveBeenCalledTimes(OUTBOX_MAX_ATTEMPTS);
    expect(await listEntries()).toHaveLength(1);

    const summary = await replayOutbox({ publish });
    expect(publish).toHaveBeenCalledTimes(OUTBOX_MAX_ATTEMPTS);
    expect(summary.dropped).toBe(1);
    expect(await listEntries()).toHaveLength(0);
  });

  it('drops an entry whose computed relay set is empty', async () => {
    await enqueue({ event: ev('b') });
    const publish = vi.fn();

    const summary = await replayOutbox({ publish, computeRelays: async () => [] });

    expect(publish).not.toHaveBeenCalled();
    expect(summary.dropped).toBe(1);
    expect(await listEntries()).toHaveLength(0);
  });
});
