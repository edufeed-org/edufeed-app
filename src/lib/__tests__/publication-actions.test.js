/**
 * createPublication: `awaitPublish` waits for a relay (naddr hints = the accepting
 * relays) and rejects with publish_failed when none accepted; `dTag` publishes
 * under a known address. Without options it stays optimistic.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** @type {any} */
let lastSigned = null;
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: {
      pubkey: 'a'.repeat(64),
      signEvent: async (/** @type {any} */ t) => (lastSigned = { ...t, pubkey: 'a'.repeat(64) })
    }
  }
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({ encodeEventToNaddr: vi.fn(() => 'naddr1test') }));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: vi.fn(),
  publishEvent: vi.fn(async () => ({ success: true, acceptedRelays: ['wss://ok.relay/'] }))
}));
vi.mock('$lib/helpers/replaceableUpdates.js', () => ({ cachePublishedEvent: vi.fn() }));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => ['wss://amb.relay/'])
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPrimaryWriteRelay: vi.fn(async () => 'wss://write.relay/')
}));

const { createPublication } = await import('../stores/publication-actions.svelte.js');
const { publishEvent, publishEventOptimistic } = await import('$lib/services/publish-service.js');
const { encodeEventToNaddr } = await import('$lib/helpers/nostrUtils.js');

const form = { title: 'Reihe', creators: [], keywords: [], subjects: [] };

beforeEach(() => {
  vi.mocked(publishEvent).mockClear();
  vi.mocked(publishEventOptimistic).mockClear();
});

describe('createPublication', () => {
  it('default: optimistic, random d', async () => {
    await createPublication(form);
    expect(publishEventOptimistic).toHaveBeenCalledOnce();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('awaitPublish + dTag: waits, hints the accepting relays, the given d', async () => {
    const { naddr } = await createPublication(form, undefined, null, {
      awaitPublish: true,
      dTag: 'lesson-c1'
    });
    expect(naddr).toBe('naddr1test');
    expect(publishEventOptimistic).not.toHaveBeenCalled();
    expect(lastSigned.tags.find((/** @type {string[]} */ t) => t[0] === 'd')[1]).toBe('lesson-c1');
    expect(vi.mocked(encodeEventToNaddr).mock.calls.at(-1)?.[1]).toEqual(['wss://ok.relay/']);
  });

  it('awaitPublish: no relay accepted → publish_failed', async () => {
    vi.mocked(publishEvent).mockResolvedValueOnce(
      /** @type {any} */ ({ success: false, acceptedRelays: [] })
    );
    await expect(createPublication(form, undefined, null, { awaitPublish: true })).rejects.toThrow(
      'publish_failed'
    );
  });
});
