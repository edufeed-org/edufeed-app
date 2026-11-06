/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { createQuota } from '../termi/quota.js';

const DAY = 86_400_000;

describe('createQuota', () => {
  it('refuses the 41st request of one pubkey on one day with "user"', () => {
    const t = Date.UTC(2026, 10, 6, 12);
    const quota = createQuota({ perUserDaily: 40, globalMonthly: 2800, now: () => t });
    for (let i = 0; i < 40; i++) expect(quota.take('alice')).toBe('ok');
    expect(quota.take('alice')).toBe('user');
    expect(quota.take('bob')).toBe('ok');
  });

  it('resets the per-user count on a new day', () => {
    let t = Date.UTC(2026, 10, 6, 23);
    const quota = createQuota({ perUserDaily: 2, globalMonthly: 2800, now: () => t });
    quota.take('alice');
    quota.take('alice');
    expect(quota.take('alice')).toBe('user');
    t += DAY;
    expect(quota.take('alice')).toBe('ok');
  });

  it('refuses everyone with "global" once the monthly cap is reached, until the next month', () => {
    let t = Date.UTC(2026, 10, 6);
    const quota = createQuota({ perUserDaily: 40, globalMonthly: 3, now: () => t });
    expect(quota.take('a')).toBe('ok');
    expect(quota.take('b')).toBe('ok');
    expect(quota.take('c')).toBe('ok');
    expect(quota.take('d')).toBe('global');
    t = Date.UTC(2026, 11, 1);
    expect(quota.take('d')).toBe('ok');
  });
});
