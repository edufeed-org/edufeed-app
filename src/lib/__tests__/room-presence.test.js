/**
 * Room presence staleness pruning tests
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pruneStalePresence } from '$lib/helpers/meet.js';

describe('pruneStalePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes entries older than maxAge', () => {
    const now = 1000;
    vi.setSystemTime(now * 1000); // Date.now() in ms

    const entries = new Map([
      ['pubkey1', now - 100], // 100s ago — stale
      ['pubkey2', now - 30], // 30s ago — fresh
      ['pubkey3', now - 91] // 91s ago — stale (default 90s)
    ]);

    const result = pruneStalePresence(entries, 90);
    expect(result.size).toBe(1);
    expect(result.has('pubkey2')).toBe(true);
    expect(result.has('pubkey1')).toBe(false);
    expect(result.has('pubkey3')).toBe(false);
  });

  it('keeps all entries if none are stale', () => {
    const now = 1000;
    vi.setSystemTime(now * 1000);

    const entries = new Map([
      ['pubkey1', now - 10],
      ['pubkey2', now - 50],
      ['pubkey3', now]
    ]);

    const result = pruneStalePresence(entries, 90);
    expect(result.size).toBe(3);
  });

  it('returns empty map when all entries are stale', () => {
    const now = 1000;
    vi.setSystemTime(now * 1000);

    const entries = new Map([
      ['pubkey1', now - 200],
      ['pubkey2', now - 150]
    ]);

    const result = pruneStalePresence(entries, 90);
    expect(result.size).toBe(0);
  });

  it('returns empty map for empty input', () => {
    vi.setSystemTime(1000000);
    const result = pruneStalePresence(new Map(), 90);
    expect(result.size).toBe(0);
  });

  it('keeps entries at exact boundary', () => {
    const now = 1000;
    vi.setSystemTime(now * 1000);

    const entries = new Map([
      ['pubkey1', now - 90] // exactly 90s — boundary, should be pruned (> not >=)
    ]);

    const result = pruneStalePresence(entries, 90);
    // At exactly maxAge, the entry is stale
    expect(result.size).toBe(0);
  });
});
