/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: vi.fn(() => ({}))
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => [],
  // loaders/base.js reads this via an import-time getter since cd1a6a25
  getEventLoaderLookupRelays: () => []
}));

import { isWave, canWave } from '$lib/helpers/waves.js';

describe('isWave', () => {
  it('returns true for kind 7 with k=0 tag', () => {
    const event = {
      kind: 7,
      content: '👋',
      tags: [
        ['e', 'abc123'],
        ['p', 'targetpubkey'],
        ['k', '0'],
        ['a', '0:targetpubkey:']
      ]
    };
    expect(isWave(event)).toBe(true);
  });

  it('returns false for kind 7 with k=1 tag', () => {
    const event = {
      kind: 7,
      content: '👍',
      tags: [
        ['e', 'abc123'],
        ['p', 'targetpubkey'],
        ['k', '1']
      ]
    };
    expect(isWave(event)).toBe(false);
  });

  it('returns false for kind 7 without k tag', () => {
    const event = {
      kind: 7,
      content: '❤️',
      tags: [
        ['e', 'abc123'],
        ['p', 'targetpubkey']
      ]
    };
    expect(isWave(event)).toBe(false);
  });

  it('returns false for non-kind-7 event', () => {
    const event = {
      kind: 1,
      content: 'hello',
      tags: [['k', '0']]
    };
    expect(isWave(event)).toBe(false);
  });

  it('returns false for undefined/null input', () => {
    expect(isWave(null)).toBe(false);
    expect(isWave(undefined)).toBe(false);
  });
});

describe('canWave', () => {
  const TWENTY_FOUR_HOURS = 24 * 60 * 60;

  it('returns canWave true when no reactions exist', () => {
    const result = canWave([], 'mypubkey');
    expect(result).toEqual({ canWave: true });
  });

  it('returns canWave true when no waves from myPubkey exist', () => {
    const reactions = [
      {
        kind: 7,
        content: '❤️',
        pubkey: 'mypubkey',
        created_at: Math.floor(Date.now() / 1000),
        tags: [['k', '1']]
      },
      {
        kind: 7,
        content: '👋',
        pubkey: 'otherpubkey',
        created_at: Math.floor(Date.now() / 1000),
        tags: [['k', '0']]
      }
    ];
    const result = canWave(reactions, 'mypubkey');
    expect(result).toEqual({ canWave: true });
  });

  it('returns canWave false with cooldownUntil when waved within 24h', () => {
    const recentTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const reactions = [
      {
        kind: 7,
        content: '👋',
        pubkey: 'mypubkey',
        created_at: recentTimestamp,
        tags: [['k', '0']]
      }
    ];
    const result = canWave(reactions, 'mypubkey');
    expect(result.canWave).toBe(false);
    expect(result.cooldownUntil).toBe(recentTimestamp + TWENTY_FOUR_HOURS);
  });

  it('returns canWave true when wave is older than 24h', () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - TWENTY_FOUR_HOURS - 100;
    const reactions = [
      {
        kind: 7,
        content: '👋',
        pubkey: 'mypubkey',
        created_at: oldTimestamp,
        tags: [['k', '0']]
      }
    ];
    const result = canWave(reactions, 'mypubkey');
    expect(result).toEqual({ canWave: true });
  });

  it('uses most recent wave for cooldown check', () => {
    const now = Math.floor(Date.now() / 1000);
    const reactions = [
      {
        kind: 7,
        content: '👋',
        pubkey: 'mypubkey',
        created_at: now - TWENTY_FOUR_HOURS - 100, // old wave
        tags: [['k', '0']]
      },
      {
        kind: 7,
        content: '👋',
        pubkey: 'mypubkey',
        created_at: now - 1800, // 30 min ago
        tags: [['k', '0']]
      }
    ];
    const result = canWave(reactions, 'mypubkey');
    expect(result.canWave).toBe(false);
    expect(result.cooldownUntil).toBe(now - 1800 + TWENTY_FOUR_HOURS);
  });
});
