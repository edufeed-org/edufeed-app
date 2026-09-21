/**
 * NIP-85 trusted assertions (kind 30382) — the parse step, the batch loader
 * and the in-memory score cache that useTrustScores() reads. Scores come
 * from a configured provider key (Brainstorm's house key by default) on a
 * configured scores relay; nothing here is a hard filter, the app only
 * ORDERS and ANNOTATES with it.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject, of } from 'rxjs';

const PROVIDER = 'a'.repeat(64);
const OTHER_PROVIDER = 'b'.repeat(64);
const LAOC = '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6';
const JOERG = '4fa5d1c413e2b45e10d40bf3562ab701a5331206e359c90baae0e99bfd6c6e41';

const infra = vi.hoisted(() => ({
  request: vi.fn(),
  add: vi.fn()
}));
const cfg = vi.hoisted(() => ({
  relays: ['wss://scores.example'],
  providers: ['a'.repeat(64)]
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { request: infra.request },
  eventStore: { add: infra.add }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getTrustAssertionRelays: () => cfg.relays,
  getTrustAssertionProviders: () => cfg.providers
}));

/**
 * @param {string} subject
 * @param {Record<string, string>} tags
 * @param {{pubkey?: string, created_at?: number}} [opts]
 */
function assertion(subject, tags, { pubkey = PROVIDER, created_at = 100 } = {}) {
  return {
    kind: 30382,
    id: `${subject.slice(0, 8)}-${created_at}`,
    pubkey,
    created_at,
    content: '',
    tags: [['d', subject], ...Object.entries(tags)]
  };
}

describe('parseTrustAssertion', () => {
  it('maps the NIP-85 / GrapeRank tags to numbers and keeps the provider', async () => {
    const { parseTrustAssertion } = await import('$lib/loaders/trust-assertions.js');
    expect(
      parseTrustAssertion(
        assertion(LAOC, { rank: '94', followers: '532', reporters: '0', muters: '1', hops: '2' })
      )
    ).toEqual({
      pubkey: LAOC,
      provider: PROVIDER,
      createdAt: 100,
      rank: 94,
      followers: 532,
      reporters: 0,
      muters: 1,
      hops: 2
    });
  });

  it('returns null for the wrong kind, a missing d tag or a non-hex subject; unknown metrics become null', async () => {
    const { parseTrustAssertion } = await import('$lib/loaders/trust-assertions.js');
    expect(parseTrustAssertion({ ...assertion(LAOC, { rank: '1' }), kind: 30383 })).toBeNull();
    expect(parseTrustAssertion({ ...assertion(LAOC, {}), tags: [['rank', '1']] })).toBeNull();
    expect(parseTrustAssertion(assertion('not-hex', { rank: '1' }))).toBeNull();
    expect(parseTrustAssertion(assertion(LAOC, { rank: 'lots' }))).toMatchObject({
      rank: null,
      hops: null,
      followers: null
    });
  });
});

describe('trustAssertionsLoader', () => {
  beforeEach(() => {
    vi.resetModules();
    infra.request.mockReset();
    infra.add.mockReset();
    cfg.relays = ['wss://scores.example'];
    cfg.providers = [PROVIDER];
  });

  it('requests kind 30382 from the configured providers for the given subjects and feeds the EventStore', async () => {
    const ev = assertion(LAOC, { rank: '94' });
    infra.request.mockReturnValue(of(ev));
    const { trustAssertionsLoader } = await import('$lib/loaders/trust-assertions.js');
    /** @type {any[]} */
    const seen = [];
    await new Promise((resolve) =>
      trustAssertionsLoader([LAOC, JOERG]).subscribe({
        next: (e) => {
          seen.push(e);
        },
        complete: () => resolve(undefined)
      })
    );
    expect(infra.request).toHaveBeenCalledWith(
      ['wss://scores.example'],
      { kinds: [30382], authors: [PROVIDER], '#d': [LAOC, JOERG] },
      expect.objectContaining({ timeout: expect.any(Number) })
    );
    expect(infra.add).toHaveBeenCalledWith(ev);
    expect(seen).toEqual([ev]);
  });

  it('completes immediately without a request when relays, providers or subjects are empty', async () => {
    const { trustAssertionsLoader } = await import('$lib/loaders/trust-assertions.js');
    cfg.relays = [];
    await new Promise((resolve) =>
      trustAssertionsLoader([LAOC]).subscribe({ complete: () => resolve(undefined) })
    );
    cfg.relays = ['wss://scores.example'];
    cfg.providers = [];
    await new Promise((resolve) =>
      trustAssertionsLoader([LAOC]).subscribe({ complete: () => resolve(undefined) })
    );
    cfg.providers = [PROVIDER];
    await new Promise((resolve) =>
      trustAssertionsLoader([]).subscribe({ complete: () => resolve(undefined) })
    );
    expect(infra.request).not.toHaveBeenCalled();
  });

  it('drops non-hex subjects (tag-derived input) instead of widening the filter', async () => {
    infra.request.mockReturnValue(of());
    const { trustAssertionsLoader } = await import('$lib/loaders/trust-assertions.js');
    await new Promise((resolve) =>
      trustAssertionsLoader([LAOC, 'name:Erika', '']).subscribe({
        complete: () => resolve(undefined)
      })
    );
    expect(infra.request).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ '#d': [LAOC] }),
      expect.anything()
    );
  });
});

describe('trust score cache (requestTrustScores / getTrustScore / trustScoreUpdates)', () => {
  beforeEach(() => {
    vi.resetModules();
    infra.request.mockReset();
    infra.add.mockReset();
    cfg.relays = ['wss://scores.example'];
    cfg.providers = [PROVIDER];
  });

  it('asks each subject once, caches the parsed score and notifies subscribers', async () => {
    const remote = new Subject();
    infra.request.mockReturnValue(remote);
    const { requestTrustScores, getTrustScore, trustScoreUpdates } = await import(
      '$lib/loaders/trust-assertions.js'
    );
    const listener = vi.fn();
    const sub = trustScoreUpdates.subscribe(listener);

    requestTrustScores([LAOC, JOERG]);
    requestTrustScores([LAOC]); // already asked → no second request
    expect(infra.request).toHaveBeenCalledTimes(1);
    expect(getTrustScore(LAOC)).toBeUndefined();

    remote.next(assertion(LAOC, { rank: '94', hops: '2' }));
    expect(getTrustScore(LAOC)).toMatchObject({ rank: 94, hops: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
    remote.complete();
    sub.unsubscribe();
  });

  it('keeps the newest assertion per subject and ignores keys that are not configured providers', async () => {
    const remote = new Subject();
    infra.request.mockReturnValue(remote);
    const { requestTrustScores, getTrustScore } = await import('$lib/loaders/trust-assertions.js');
    requestTrustScores([LAOC]);
    remote.next(assertion(LAOC, { rank: '90' }, { created_at: 200 }));
    remote.next(assertion(LAOC, { rank: '10' }, { created_at: 100 }));
    remote.next(assertion(LAOC, { rank: '1' }, { pubkey: OTHER_PROVIDER, created_at: 300 }));
    expect(getTrustScore(LAOC)?.rank).toBe(90);
  });

  it('a relay error is swallowed — the picker keeps working without scores', async () => {
    const remote = new Subject();
    infra.request.mockReturnValue(remote);
    const { requestTrustScores, getTrustScore } = await import('$lib/loaders/trust-assertions.js');
    expect(() => {
      requestTrustScores([LAOC]);
      remote.error(new Error('relay down'));
    }).not.toThrow();
    expect(getTrustScore(LAOC)).toBeUndefined();
  });
});
