// @ts-nocheck
/** @vitest-environment node */
// Pure logic behind the relay-health surfaces: the per-device probe history
// that decides when a relay in the user's kind 10002 counts as dead for a
// while (Termi hint), the replacement pick, and the tag rewrite that keeps
// every other tag of the list intact (Dilger: never clobber what you did not
// understand).
import { describe, it, expect } from 'vitest';
import {
  DAY_MS,
  recordProbeOutcome,
  findDeadRelays,
  pickReplacementRelay,
  replaceRelayInList,
  relayKey
} from '$lib/helpers/relay-health.js';

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0); // 2026-10-20 12:00Z

describe('relayKey', () => {
  it('ignores case and a trailing slash', () => {
    expect(relayKey('wss://Nos.lol/')).toBe(relayKey('wss://nos.lol'));
    expect(relayKey('wss://relay.example/inbox/')).not.toBe(relayKey('wss://relay.example/'));
  });
});

describe('recordProbeOutcome', () => {
  it('starts a failure streak on the first failed probe', () => {
    const h = recordProbeOutcome({}, 'wss://nos.lol', false, T0);
    const r = h[relayKey('wss://nos.lol')];
    expect(r.firstFailedAt).toBe(T0);
    expect(r.lastFailedAt).toBe(T0);
    expect(r.failureDays).toEqual(['2026-10-20']);
    expect(r.lastSuccessAt).toBe(0);
  });

  it('keeps the first failure and counts distinct days only', () => {
    let h = recordProbeOutcome({}, 'wss://nos.lol', false, T0);
    h = recordProbeOutcome(h, 'wss://nos.lol', false, T0 + 3_600_000); // same day
    h = recordProbeOutcome(h, 'wss://nos.lol', false, T0 + 2 * DAY_MS);
    const r = h[relayKey('wss://nos.lol')];
    expect(r.firstFailedAt).toBe(T0);
    expect(r.lastFailedAt).toBe(T0 + 2 * DAY_MS);
    expect(r.failureDays).toEqual(['2026-10-20', '2026-10-22']);
  });

  it('a success ends the streak', () => {
    let h = recordProbeOutcome({}, 'wss://nos.lol', false, T0);
    h = recordProbeOutcome(h, 'wss://nos.lol', true, T0 + DAY_MS);
    const r = h[relayKey('wss://nos.lol')];
    expect(r.lastSuccessAt).toBe(T0 + DAY_MS);
    expect(r.firstFailedAt).toBe(0);
    expect(r.failureDays).toEqual([]);
  });

  it('does not mutate the previous history object', () => {
    const before = {};
    recordProbeOutcome(before, 'wss://nos.lol', false, T0);
    expect(before).toEqual({});
  });
});

describe('findDeadRelays', () => {
  const dead = (first, days) => ({
    firstFailedAt: first,
    lastFailedAt: first + (days.length - 1) * DAY_MS,
    lastSuccessAt: 0,
    failureDays: days
  });

  it('reports a relay that failed on two days, three days apart, with no success since', () => {
    const h = { [relayKey('wss://nos.lol')]: dead(T0, ['2026-10-20', '2026-10-23']) };
    const now = T0 + 3 * DAY_MS;
    expect(findDeadRelays(h, ['wss://nos.lol', 'wss://relay.damus.io'], now)).toEqual([
      { url: 'wss://nos.lol', days: 3 }
    ]);
  });

  it('needs the streak to be old enough', () => {
    const h = { [relayKey('wss://nos.lol')]: dead(T0, ['2026-10-20', '2026-10-21']) };
    expect(findDeadRelays(h, ['wss://nos.lol'], T0 + DAY_MS)).toEqual([]);
    expect(findDeadRelays(h, ['wss://nos.lol'], T0 + 3 * DAY_MS)).toHaveLength(1);
  });

  it('needs failures on at least two distinct days — one bad evening is not a dead relay', () => {
    const h = { [relayKey('wss://nos.lol')]: dead(T0, ['2026-10-20']) };
    expect(findDeadRelays(h, ['wss://nos.lol'], T0 + 5 * DAY_MS)).toEqual([]);
  });

  it('ignores relays that are not in the list any more, and unknown relays', () => {
    const h = { [relayKey('wss://nos.lol')]: dead(T0, ['2026-10-20', '2026-10-23']) };
    expect(findDeadRelays(h, ['wss://relay.damus.io'], T0 + 5 * DAY_MS)).toEqual([]);
    expect(findDeadRelays({}, ['wss://nos.lol'], T0 + 5 * DAY_MS)).toEqual([]);
  });

  it('matches list urls to history keys case- and slash-insensitively, returning the list spelling', () => {
    const h = { [relayKey('wss://nos.lol')]: dead(T0, ['2026-10-20', '2026-10-23']) };
    expect(findDeadRelays(h, ['wss://NOS.lol/'], T0 + 5 * DAY_MS)).toEqual([
      { url: 'wss://NOS.lol/', days: 5 }
    ]);
  });
});

describe('pickReplacementRelay', () => {
  it('returns the first default not already in the list', () => {
    expect(
      pickReplacementRelay(
        ['wss://relay.damus.io', 'wss://relay.primal.net', 'wss://relay.edufeed.org'],
        ['wss://relay.damus.io/', 'wss://nos.lol']
      )
    ).toBe('wss://relay.primal.net');
  });

  it('skips defaults that are themselves known dead', () => {
    expect(
      pickReplacementRelay(
        ['wss://relay.primal.net', 'wss://relay.edufeed.org'],
        ['wss://nos.lol'],
        ['wss://relay.primal.net']
      )
    ).toBe('wss://relay.edufeed.org');
  });

  it('returns null when every default is already listed', () => {
    expect(pickReplacementRelay(['wss://a.example'], ['wss://a.example'])).toBeNull();
    expect(pickReplacementRelay([], ['wss://a.example'])).toBeNull();
  });
});

describe('replaceRelayInList', () => {
  const event = {
    kind: 10002,
    pubkey: 'a'.repeat(64),
    content: '',
    created_at: 1700000000,
    tags: [
      ['r', 'wss://relay.damus.io'],
      ['r', 'wss://nos.lol', 'read'],
      ['r', 'wss://relay.edufeed.org', 'write'],
      ['client', 'Edufeed'],
      ['alt', 'relay list']
    ]
  };

  it('swaps the dead relay for the replacement, keeping its marker and every other tag', () => {
    const t = replaceRelayInList(event, 'wss://nos.lol/', 'wss://relay.primal.net');
    expect(t.kind).toBe(10002);
    expect(t.content).toBe('');
    expect(t.tags).toEqual([
      ['r', 'wss://relay.damus.io'],
      ['r', 'wss://relay.primal.net', 'read'],
      ['r', 'wss://relay.edufeed.org', 'write'],
      ['client', 'Edufeed'],
      ['alt', 'relay list']
    ]);
    // the original is untouched
    expect(event.tags[1]).toEqual(['r', 'wss://nos.lol', 'read']);
  });

  it('removes the dead relay when there is no replacement', () => {
    const t = replaceRelayInList(event, 'wss://nos.lol', null);
    expect(t.tags.map((x) => x[1])).toEqual([
      'wss://relay.damus.io',
      'wss://relay.edufeed.org',
      'Edufeed',
      'relay list'
    ]);
  });

  it('removes instead of duplicating when the replacement is already listed', () => {
    const t = replaceRelayInList(event, 'wss://nos.lol', 'wss://relay.damus.io/');
    expect(t.tags.filter((x) => x[0] === 'r')).toEqual([
      ['r', 'wss://relay.damus.io'],
      ['r', 'wss://relay.edufeed.org', 'write']
    ]);
  });

  it('drops a duplicated dead r-tag entirely (malformed lists happen)', () => {
    const dup = { ...event, tags: [...event.tags, ['r', 'wss://nos.lol/', 'write']] };
    const t = replaceRelayInList(dup, 'wss://nos.lol', 'wss://relay.primal.net');
    const urls = t.tags.filter((x) => x[0] === 'r').map((x) => x[1]);
    expect(urls.filter((u) => u.includes('nos.lol'))).toEqual([]);
    expect(urls.filter((u) => u === 'wss://relay.primal.net')).toHaveLength(1);
  });
});
