/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

  describe('with a stateFile', () => {
    const tmpFile = () =>
      path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'termi-quota-')), 'quota.json');

    it('the monthly counter survives a re-import (= a deploy)', async () => {
      const stateFile = tmpFile();
      const t = Date.UTC(2026, 10, 6);
      const opts = { perUserDaily: 40, globalMonthly: 2, now: () => t, stateFile };
      createQuota(opts).charge('a');
      vi.resetModules();
      const fresh = await import('../termi/quota.js');
      const quota = fresh.createQuota(opts);
      expect(quota.check('b')).toBe('ok');
      quota.charge('b');
      expect(quota.check('c')).toBe('global');
    });

    it('a stored count from last month starts at 0', () => {
      const stateFile = tmpFile();
      const opts = { perUserDaily: 40, globalMonthly: 1, stateFile };
      createQuota({ ...opts, now: () => Date.UTC(2026, 9, 31) }).charge('a');
      expect(createQuota({ ...opts, now: () => Date.UTC(2026, 9, 31) }).check('b')).toBe('global');
      expect(createQuota({ ...opts, now: () => Date.UTC(2026, 10, 1) }).check('b')).toBe('ok');
    });

    it('a missing or corrupt file starts at 0', () => {
      const stateFile = tmpFile();
      const opts = { perUserDaily: 40, globalMonthly: 1, now: () => 0, stateFile };
      expect(createQuota(opts).check('a')).toBe('ok');
      fs.writeFileSync(stateFile, '{not json');
      expect(createQuota(opts).check('a')).toBe('ok');
    });
  });
});

describe('createQuota remaining()', () => {
  it('reports left/total without charging, 0 once the monthly cap is gone', () => {
    const quota = createQuota({ perUserDaily: 5, globalMonthly: 3, now: () => 0 });
    expect(quota.remaining('a')).toEqual({ left: 5, total: 5 });
    quota.charge('a');
    expect(quota.remaining('a')).toEqual({ left: 4, total: 5 });
    chargeTimes(quota, 'b', 2);
    expect(quota.remaining('a')).toEqual({ left: 0, total: 5 });
  });
});
