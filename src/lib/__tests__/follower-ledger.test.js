/** @vitest-environment node */
/**
 * follower-ledger — "X folgt dir jetzt" without false alarms. Contact lists
 * (kind 3) are replaceable: a follower who follows anyone else republishes
 * theirs, with a new id and created_at. The ledger remembers who was already
 * known; the first run records everyone silently; the inbox items it yields
 * are stable (id and time of the first sighting).
 */
import { describe, it, expect } from 'vitest';
import {
  emptyLedger,
  recordFollowers,
  markSeeded,
  followerNotifications,
  parseLedger
} from '$lib/helpers/follower-ledger.js';

const ME = 'f'.repeat(64);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

/** @param {string} pubkey @param {string[]} follows @param {number} created_at */
const kind3 = (pubkey, follows, created_at) => ({
  kind: 3,
  pubkey,
  created_at,
  tags: follows.map((p) => ['p', p]),
  content: ''
});

describe('recordFollowers', () => {
  it('records everyone silently until the ledger is seeded', () => {
    const ledger = recordFollowers(emptyLedger(), [kind3(A, [ME], 100)], ME);
    expect(ledger.known).toEqual({ [A]: 0 });
    expect(followerNotifications(ledger, ME, 200)).toEqual([]);
  });

  it('after seeding, a new follower is recorded at the time of their list', () => {
    let ledger = markSeeded(recordFollowers(emptyLedger(), [kind3(A, [ME], 100)], ME), 0);
    ledger = recordFollowers(ledger, [kind3(A, [ME], 150), kind3(B, [ME], 160)], ME);
    expect(ledger.known).toEqual({ [A]: 0, [B]: 160 });
  });

  it('an old list that only shows up after seeding is no new follow', () => {
    // Seeded at 1000; another surface (the profile's follower list, other
    // relays) later loads a contact list from before that — a past follow.
    let ledger = markSeeded(emptyLedger(), 1000);
    ledger = recordFollowers(ledger, [kind3(A, [ME], 400), kind3(B, [ME], 1200)], ME);
    expect(ledger.known).toEqual({ [A]: 0, [B]: 1200 });
  });

  it('a republished list never moves the first sighting', () => {
    let ledger = markSeeded(emptyLedger(), 0);
    ledger = recordFollowers(ledger, [kind3(B, [ME], 160)], ME);
    const again = recordFollowers(ledger, [kind3(B, [ME, A], 999)], ME);
    expect(again).toBe(ledger); // unchanged ledger, same object
  });

  it('ignores lists without the user and the user’s own list', () => {
    const ledger = recordFollowers(
      markSeeded(emptyLedger(), 0),
      [kind3(A, [B], 1), kind3(ME, [ME], 2)],
      ME
    );
    expect(ledger.known).toEqual({});
  });
});

describe('followerNotifications', () => {
  it('yields stable synthetic items, newest first, within the window', () => {
    let ledger = markSeeded(emptyLedger(), 0);
    ledger = recordFollowers(ledger, [kind3(A, [ME], 1000), kind3(B, [ME], 2000)], ME);
    const items = followerNotifications(ledger, ME, 2000 + 10, 5000);
    expect(items).toEqual([
      { id: `follow:${B}`, kind: 3, pubkey: B, created_at: 2000, tags: [['p', ME]], content: '' },
      { id: `follow:${A}`, kind: 3, pubkey: A, created_at: 1000, tags: [['p', ME]], content: '' }
    ]);
    expect(followerNotifications(ledger, ME, 7000, 5000).map((i) => i.pubkey)).toEqual([B]);
  });
});

describe('parseLedger', () => {
  it('round-trips and survives garbage', () => {
    const ledger = recordFollowers(markSeeded(emptyLedger(), 0), [kind3(A, [ME], 5)], ME);
    expect(parseLedger(JSON.stringify(ledger))).toEqual(ledger);
    expect(parseLedger('{broken')).toEqual(emptyLedger());
    expect(parseLedger(null)).toEqual(emptyLedger());
  });
});
