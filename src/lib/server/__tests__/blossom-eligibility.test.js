// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  parseEligibilityConfig,
  createEligibilityChecker,
  normalizePubkey
} from '../blossom-eligibility.js';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);

/** @param {Record<string, string>} names */
function okResponse(names) {
  return new Response(JSON.stringify({ names }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('normalizePubkey', () => {
  it('accepts hex in any case and npub', () => {
    expect(normalizePubkey(ALICE.toUpperCase())).toBe(ALICE);
    expect(normalizePubkey(nip19.npubEncode(BOB))).toBe(BOB);
  });
  it('rejects garbage', () => {
    expect(normalizePubkey('nope')).toBeNull();
    expect(normalizePubkey('')).toBeNull();
    expect(normalizePubkey(undefined)).toBeNull();
    expect(normalizePubkey(nip19.noteEncode(ALICE))).toBeNull();
  });
});

describe('parseEligibilityConfig', () => {
  it('gate is off when nothing is configured', () => {
    const cfg = parseEligibilityConfig({});
    expect(cfg.gated).toBe(false);
    expect(cfg.pubkeys.size).toBe(0);
    expect(cfg.domains).toEqual([]);
  });

  it('parses hex + npub pubkeys and drops invalid entries', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = parseEligibilityConfig({
      BLOSSOM_ELIGIBLE_PUBKEYS: `${ALICE.toUpperCase()}, ${nip19.npubEncode(BOB)}, junk`
    });
    expect([...cfg.pubkeys]).toEqual([ALICE, BOB]);
    expect(cfg.gated).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('lowercases and trims domains, strips a scheme', () => {
    const cfg = parseEligibilityConfig({
      BLOSSOM_ELIGIBLE_NIP05_DOMAINS: ' Edufeed.org, https://Partner.example/ '
    });
    expect(cfg.domains).toEqual(['edufeed.org', 'partner.example']);
    expect(cfg.gated).toBe(true);
  });
});

describe('createEligibilityChecker', () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let fetchImpl;
  let now = 1_000_000;
  const clock = () => now;

  beforeEach(() => {
    now = 1_000_000;
    fetchImpl = vi.fn(async () => okResponse({ alice: ALICE }));
  });

  it('gate off → everyone eligible, no fetch', async () => {
    const checker = createEligibilityChecker(parseEligibilityConfig({}), { fetchImpl, now: clock });
    expect(checker.gated).toBe(false);
    await expect(checker.isEligible(CAROL)).resolves.toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allowlist hit needs no fetch', async () => {
    const cfg = parseEligibilityConfig({
      BLOSSOM_ELIGIBLE_PUBKEYS: BOB,
      BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org'
    });
    const checker = createEligibilityChecker(cfg, { fetchImpl, now: clock });
    await expect(checker.isEligible(BOB)).resolves.toBe(true);
    await expect(checker.isEligible(nip19.npubEncode(BOB))).resolves.toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('domain map hit / miss, compared case-insensitively', async () => {
    fetchImpl.mockResolvedValue(okResponse({ alice: ALICE.toUpperCase() }));
    const cfg = parseEligibilityConfig({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    const checker = createEligibilityChecker(cfg, { fetchImpl, now: clock });
    await expect(checker.isEligible(ALICE)).resolves.toBe(true);
    await expect(checker.isEligible(CAROL)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://edufeed.org/.well-known/nostr.json');
  });

  it('unknown pubkey format is never eligible', async () => {
    const cfg = parseEligibilityConfig({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    const checker = createEligibilityChecker(cfg, { fetchImpl, now: clock });
    await expect(checker.isEligible('garbage')).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caches per domain for the TTL and refetches afterwards', async () => {
    const cfg = parseEligibilityConfig({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    const checker = createEligibilityChecker(cfg, { fetchImpl, now: clock, ttlMs: 300_000 });
    await checker.isEligible(ALICE);
    now += 299_000;
    await checker.isEligible(ALICE);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 2_000;
    await checker.isEligible(ALICE);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('serves the stale map when a refetch fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = parseEligibilityConfig({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    const checker = createEligibilityChecker(cfg, { fetchImpl, now: clock, ttlMs: 1000 });
    await expect(checker.isEligible(ALICE)).resolves.toBe(true);
    now += 5000;
    fetchImpl.mockRejectedValueOnce(new Error('boom'));
    await expect(checker.isEligible(ALICE)).resolves.toBe(true);
    now += 5000;
    fetchImpl.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    await expect(checker.isEligible(ALICE)).resolves.toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('a domain that never loaded makes the answer undetermined, not "no"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchImpl.mockRejectedValue(new Error('down'));
    const cfg = parseEligibilityConfig({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    const checker = createEligibilityChecker(cfg, { fetchImpl, now: clock });
    await expect(checker.isEligible(ALICE)).resolves.toBeNull();
    // the allowlist still answers definitively
    const cfg2 = parseEligibilityConfig({
      BLOSSOM_ELIGIBLE_PUBKEYS: BOB,
      BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org'
    });
    const checker2 = createEligibilityChecker(cfg2, { fetchImpl, now: clock });
    await expect(checker2.isEligible(BOB)).resolves.toBe(true);
  });

  it('does not re-fetch a dead domain within the failure window', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchImpl.mockRejectedValue(new Error('down'));
    const cfg = parseEligibilityConfig({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    const checker = createEligibilityChecker(cfg, { fetchImpl, now: clock });
    await checker.isEligible(ALICE);
    now += 10_000;
    await expect(checker.isEligible(ALICE)).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 31_000;
    fetchImpl.mockResolvedValueOnce(okResponse({ alice: ALICE }));
    await expect(checker.isEligible(ALICE)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('answers "no" only when every domain was loaded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchImpl.mockImplementation(async (url) =>
      String(url).startsWith('https://a.example')
        ? okResponse({ alice: ALICE })
        : Promise.reject(new Error('down'))
    );
    const cfg = parseEligibilityConfig({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'a.example,b.example' });
    const checker = createEligibilityChecker(cfg, { fetchImpl, now: clock });
    await expect(checker.isEligible(ALICE)).resolves.toBe(true);
    await expect(checker.isEligible(CAROL)).resolves.toBeNull();
  });

  it('dedupes concurrent fetches of one domain', async () => {
    const cfg = parseEligibilityConfig({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    const checker = createEligibilityChecker(cfg, { fetchImpl, now: clock });
    await Promise.all([
      checker.isEligible(ALICE),
      checker.isEligible(BOB),
      checker.isEligible(ALICE)
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refresh bypasses the TTL at most once per minRefreshMs', async () => {
    const cfg = parseEligibilityConfig({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    const checker = createEligibilityChecker(cfg, {
      fetchImpl,
      now: clock,
      ttlMs: 300_000,
      minRefreshMs: 30_000
    });
    await checker.isEligible(ALICE);
    now += 1000;
    await checker.isEligible(ALICE, { refresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // throttled
    now += 31_000;
    fetchImpl.mockResolvedValueOnce(okResponse({ alice: ALICE, carol: CAROL }));
    await expect(checker.isEligible(CAROL, { refresh: true })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('checks every configured domain', async () => {
    fetchImpl.mockImplementation(async (url) =>
      String(url).startsWith('https://a.example')
        ? okResponse({ alice: ALICE })
        : okResponse({ bob: BOB })
    );
    const cfg = parseEligibilityConfig({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'a.example,b.example' });
    const checker = createEligibilityChecker(cfg, { fetchImpl, now: clock });
    await expect(checker.isEligible(BOB)).resolves.toBe(true);
    await expect(checker.isEligible(CAROL)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('ignores a nostr.json without a names object', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchImpl.mockResolvedValue(new Response('[]', { status: 200 }));
    const cfg = parseEligibilityConfig({ BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org' });
    const checker = createEligibilityChecker(cfg, { fetchImpl, now: clock });
    await expect(checker.isEligible(ALICE)).resolves.toBeNull();
  });
});
