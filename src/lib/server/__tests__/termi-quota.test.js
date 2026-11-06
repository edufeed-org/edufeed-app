/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { createQuota } from '../termi/quota.js';

const DAY = 86_400_000;

/** @param {ReturnType<typeof createQuota>} quota @param {string} pubkey @param {number} n */
function chargeTimes(quota, pubkey, n) {
  for (let i = 0; i < n; i++) quota.charge(pubkey);
}

describe('createQuota', () => {
  it('check() does not charge', () => {
    const quota = createQuota({ perUserDaily: 1, globalMonthly: 1, now: () => 0 });
    expect(quota.check('alice')).toBe('ok');
    expect(quota.check('alice')).toBe('ok');
  });

  it('refuses a pubkey with "user" after 40 charged steps on one day', () => {
    const t = Date.UTC(2026, 10, 6, 12);
    const quota = createQuota({ perUserDaily: 40, globalMonthly: 2800, now: () => t });
    chargeTimes(quota, 'alice', 39);
    expect(quota.check('alice')).toBe('ok');
    quota.charge('alice');
    expect(quota.check('alice')).toBe('user');
    expect(quota.check('bob')).toBe('ok');
  });

  it('resets the per-user count on a new day', () => {
    let t = Date.UTC(2026, 10, 6, 23);
    const quota = createQuota({ perUserDaily: 2, globalMonthly: 2800, now: () => t });
    chargeTimes(quota, 'alice', 2);
    expect(quota.check('alice')).toBe('user');
    t += DAY;
    expect(quota.check('alice')).toBe('ok');
  });

  it('refuses everyone with "global" once the monthly cap is reached, until the next month', () => {
    let t = Date.UTC(2026, 10, 6);
    const quota = createQuota({ perUserDaily: 40, globalMonthly: 3, now: () => t });
    quota.charge('a');
    quota.charge('b');
    expect(quota.check('d')).toBe('ok');
    quota.charge('c');
    expect(quota.check('d')).toBe('global');
    t = Date.UTC(2026, 11, 1);
    expect(quota.check('d')).toBe('ok');
  });
});
