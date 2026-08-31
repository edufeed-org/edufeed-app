/**
 * Membership application routing + applicant reachability.
 *
 * A kind 1069 membership application carries the applicant's real name,
 * affiliation and motivation. Even NIP-44-encrypted it must not be blasted at
 * the public fallback relays — which is exactly what the generic outbox
 * publisher does for an applicant with no kind 10002 (2026-07-28: 13
 * applications on nos.lol). Backfilling a relay list does not fix that on its
 * own, because the default relay list IS the fallback list.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every case injects its own collaborators; these stubs only keep the module's
// default imports (rune-based services, applesauce) out of the import graph.
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ pool: {} }));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active: null } }));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: () => []
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getCommunikeyRelays: () => [] }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  fetchRelayListResolution: async () => ({ relayList: null, outcome: 'absent' }),
  invalidateRelayListCache: () => {}
}));
vi.mock('$lib/services/relay-list-backfill.js', () => ({
  publishDefaultRelayList: async () => null
}));
vi.mock('$lib/services/dm-relay-backfill.js', () => ({ ensureDmRelayList: async () => {} }));

const APP_RELAYS = ['wss://relay.edufeed.org', 'wss://dev.relay.edufeed.org'];
const PUBLIC_FALLBACKS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://nostr.wine'];

describe('getApplicationRelays', () => {
  /** @param {object} deps */
  async function run(deps) {
    const { getApplicationRelays } = await import('$lib/services/membership-publish.js');
    return getApplicationRelays(/** @type {any} */ (deps));
  }

  it('routes applications to the app-managed communikey relays', async () => {
    const relays = await run({
      getAppRelays: () => [...APP_RELAYS],
      getCommunikeyRelays: () => [...APP_RELAYS, ...PUBLIC_FALLBACKS]
    });

    expect(relays).toEqual(APP_RELAYS);
  });

  it('never routes an application to a public fallback relay', async () => {
    const relays = await run({
      getAppRelays: () => [...APP_RELAYS],
      getCommunikeyRelays: () => [...APP_RELAYS, ...PUBLIC_FALLBACKS]
    });

    for (const url of PUBLIC_FALLBACKS) {
      expect(relays).not.toContain(url);
    }
  });

  it('deduplicates repeated relay urls', async () => {
    const relays = await run({
      getAppRelays: () => ['wss://relay.edufeed.org', 'wss://relay.edufeed.org', ''],
      getCommunikeyRelays: () => []
    });

    expect(relays).toEqual(['wss://relay.edufeed.org']);
  });

  it('falls back to the read relay set when no communikey relay is configured', async () => {
    // A deployment without a dedicated communikey relay has no private place to
    // put applications — delivering them beats silently dropping every one.
    const relays = await run({
      getAppRelays: () => [],
      getCommunikeyRelays: () => [...PUBLIC_FALLBACKS]
    });

    expect(relays).toEqual(PUBLIC_FALLBACKS);
  });
});

describe('publishApplicationCopy', () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let poolPublish;
  /** @type {{ publish: ReturnType<typeof vi.fn> }} */
  let pool;

  const signed = { kind: 1069, id: 'app1', pubkey: 'applicant', tags: [], content: 'enc' };

  beforeEach(() => {
    // applesauce's pool.publish answers with one PublishResponse per relay, and
    // reports an unreachable relay as { ok: false } rather than throwing.
    poolPublish = vi.fn(async (/** @type {string[]} */ relays) =>
      relays.map((from) => ({ ok: true, from }))
    );
    pool = { publish: poolPublish };
  });

  /** @param {object} [deps] */
  async function run(deps = {}) {
    const { publishApplicationCopy } = await import('$lib/services/membership-publish.js');
    return publishApplicationCopy(
      /** @type {any} */ (signed),
      /** @type {any} */ ({
        pool,
        getAppRelays: () => [...APP_RELAYS],
        getCommunikeyRelays: () => [...APP_RELAYS, ...PUBLIC_FALLBACKS],
        ...deps
      })
    );
  }

  it('publishes to exactly the application relays', async () => {
    const result = await run();

    expect(poolPublish).toHaveBeenCalledTimes(1);
    expect(poolPublish.mock.calls[0][0]).toEqual(APP_RELAYS);
    expect(result.success).toBe(true);
    expect(result.relays).toEqual(APP_RELAYS);
  });

  it('reports failure when every relay rejects the event', async () => {
    poolPublish.mockResolvedValue(
      APP_RELAYS.map((from) => ({ ok: false, message: 'blocked', from }))
    );
    const result = await run();

    expect(result.success).toBe(false);
    expect(result.successCount).toBe(0);
  });

  it('succeeds when at least one relay accepts', async () => {
    poolPublish.mockResolvedValue([
      { ok: false, message: 'offline', from: APP_RELAYS[0] },
      { ok: true, from: APP_RELAYS[1] }
    ]);
    const result = await run();

    expect(result.success).toBe(true);
    expect(result.successCount).toBe(1);
  });

  it('fails without publishing when no relay is configured', async () => {
    const result = await run({ getAppRelays: () => [], getCommunikeyRelays: () => [] });

    expect(poolPublish).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});

describe('ensureApplicantRelayLists', () => {
  /** @type {any} */
  let deps;
  /** @type {ReturnType<typeof vi.fn>} */
  let publishDefaultRelayList;
  /** @type {ReturnType<typeof vi.fn>} */
  let ensureDmRelayList;
  /** @type {ReturnType<typeof vi.fn>} */
  let fetchRelayListResolution;
  /** @type {ReturnType<typeof vi.fn>} */
  let invalidateRelayListCache;

  beforeEach(() => {
    publishDefaultRelayList = vi.fn().mockResolvedValue({ kind: 10002 });
    ensureDmRelayList = vi.fn().mockResolvedValue(undefined);
    fetchRelayListResolution = vi.fn().mockResolvedValue({ relayList: null, outcome: 'absent' });
    invalidateRelayListCache = vi.fn();
    deps = {
      account: { pubkey: 'applicant', signer: { signEvent: vi.fn() } },
      publishDefaultRelayList,
      ensureDmRelayList,
      fetchRelayListResolution,
      invalidateRelayListCache
    };
  });

  /** @param {object} [overrides] */
  async function run(overrides = {}) {
    const { ensureApplicantRelayLists } = await import('$lib/services/membership-publish.js');
    return ensureApplicantRelayLists(/** @type {any} */ ({ ...deps, ...overrides }));
  }

  it('publishes a default kind 10002 when the applicant has none', async () => {
    await run();

    expect(fetchRelayListResolution).toHaveBeenCalledWith('applicant');
    expect(publishDefaultRelayList).toHaveBeenCalledWith(deps.account.signer);
  });

  it('does not publish a relay list when the lookup never settled', async () => {
    // A hung lookup is indistinguishable from "no list" by the value alone.
    // Publishing a default one here would supersede — and destroy — a real
    // relay list we simply never received.
    fetchRelayListResolution.mockResolvedValue({ relayList: null, outcome: 'unknown' });
    await run();

    expect(publishDefaultRelayList).not.toHaveBeenCalled();
  });

  it('backfills the kind 10050 so the approval DM has an inbox to land in', async () => {
    // Unconditionally: the "have we proved they have none" gate used to live
    // here, but it belongs to the write itself — every DM send site needs the
    // same proof. ensureDmRelayList now waits for the DM service's settle-aware
    // verdict and writes only on 'absent', so a second copy of the check here
    // could only ever disagree with the one that matters. Covered by
    // dm-relay-backfill.test.js.
    await run();

    expect(ensureDmRelayList).toHaveBeenCalledTimes(1);
  });

  it('leaves an existing relay list alone', async () => {
    fetchRelayListResolution.mockResolvedValue({
      relayList: { writeRelays: ['wss://my.relay'], readRelays: ['wss://my.relay'] },
      outcome: 'found'
    });
    await run();

    expect(publishDefaultRelayList).not.toHaveBeenCalled();
  });

  it('replaces an empty relay list', async () => {
    // An empty kind 10002 leaves the applicant unroutable just as a missing one
    // does, so existence alone must not satisfy the check.
    fetchRelayListResolution.mockResolvedValue({
      relayList: { writeRelays: [], readRelays: [] },
      outcome: 'found'
    });
    await run();

    expect(publishDefaultRelayList).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cached relay list after backfilling', async () => {
    // fetchRelayList caches an empty-but-present list for 5 minutes; without
    // invalidation the fresh 10002 would be ignored until it expires.
    fetchRelayListResolution.mockResolvedValue({
      relayList: { writeRelays: [], readRelays: [] },
      outcome: 'found'
    });
    await run();

    expect(invalidateRelayListCache).toHaveBeenCalledWith('applicant');
  });

  it('still checks the DM side when the kind 10002 lookup throws', async () => {
    // The two lists are independent — a failure on one must not skip the other.
    fetchRelayListResolution.mockRejectedValue(new Error('lookup exploded'));

    await expect(run()).resolves.toBeUndefined();
    expect(ensureDmRelayList).toHaveBeenCalledTimes(1);
  });

  it('resolves when the signer rejects the relay-list publish', async () => {
    // Relay bookkeeping must never block the application itself.
    publishDefaultRelayList.mockRejectedValue(new Error('user declined'));

    await expect(run()).resolves.toBeUndefined();
    expect(ensureDmRelayList).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without an active account', async () => {
    await run({ account: null });

    expect(fetchRelayListResolution).not.toHaveBeenCalled();
    expect(publishDefaultRelayList).not.toHaveBeenCalled();
    expect(ensureDmRelayList).not.toHaveBeenCalled();
  });
});
