/** @vitest-environment jsdom */
// Pure half of the admin join-request alert (issue 68669ba4): the Termi hint
// that tells a NIP-29 admin "there are pending Beitrittsanfragen" without them
// having to visit the members page. These helpers shape what the reactive hook
// (join-request-alerts.svelte.js) reads from the existing roster machinery:
// which of my groups I ADMIN (39001 lists me), the per-group rosters for the
// already-a-member exclusion, the group-id → community mapping for the hint's
// navigation target, and the cross-community union of locally dismissed
// request ids.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  adminGroupPointers,
  membersByGroupId,
  groupToCommunityMap,
  summarizeJoinRequestAlert
} from '$lib/groups/join-request-alerts.js';
import {
  readAllDismissedJoinRequests,
  writeDismissedJoinRequests,
  dismissedJoinRequestsKey
} from '$lib/groups/join-requests.js';
import { channelKey } from '$lib/groups/community-pointer.js';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const APPLICANT = 'c'.repeat(64);
const COMMUNITY = 'd'.repeat(64);
const COMMUNITY2 = 'e'.repeat(64);
const RELAY = 'wss://groups.example.com';

const ROOT = { id: 'root1', relay: RELAY };
const CHAN = { id: 'chan1', relay: RELAY };

describe('adminGroupPointers', () => {
  const adminsByKey = {
    [channelKey(ROOT) ?? '']: [{ pubkey: ME, roles: ['admin'] }],
    [channelKey(CHAN) ?? '']: [{ pubkey: OTHER, roles: ['admin'] }]
  };

  it('keeps only pointers whose 39001 lists the given pubkey', () => {
    expect(adminGroupPointers({ pointers: [ROOT, CHAN], adminsByKey, pubkey: ME })).toEqual([ROOT]);
  });

  it('returns nothing for groups with unknown admin lists', () => {
    expect(adminGroupPointers({ pointers: [ROOT], adminsByKey: {}, pubkey: ME })).toEqual([]);
  });

  it('tolerates empty input', () => {
    expect(adminGroupPointers({ pointers: [], adminsByKey, pubkey: ME })).toEqual([]);
    expect(adminGroupPointers({ pointers: [ROOT], adminsByKey, pubkey: '' })).toEqual([]);
  });
});

describe('membersByGroupId', () => {
  it('unions 39002 members and 39001 admins per bare group id', () => {
    const map = membersByGroupId({
      pointers: [ROOT],
      membersByKey: { [channelKey(ROOT) ?? '']: new Set([APPLICANT]) },
      adminsByKey: { [channelKey(ROOT) ?? '']: [{ pubkey: ME, roles: ['admin'] }] }
    });
    expect(map.get(ROOT.id)).toEqual(new Set([APPLICANT, ME]));
  });

  it('omits groups with no known roster at all (safe direction: overstate the queue)', () => {
    const map = membersByGroupId({ pointers: [ROOT], membersByKey: {}, adminsByKey: {} });
    expect(map.has(ROOT.id)).toBe(false);
  });

  it('uses the admins alone when the 39002 has not arrived', () => {
    const map = membersByGroupId({
      pointers: [ROOT],
      membersByKey: {},
      adminsByKey: { [channelKey(ROOT) ?? '']: [{ pubkey: ME, roles: ['admin'] }] }
    });
    expect(map.get(ROOT.id)).toEqual(new Set([ME]));
  });
});

describe('groupToCommunityMap', () => {
  /** @param {string} pubkey @param {string[][]} tags */
  const community = (pubkey, tags) => ({ kind: 10222, pubkey, tags });

  it('maps the membership pointer and every group pointer to the community pubkey', () => {
    const map = groupToCommunityMap([
      community(COMMUNITY, [
        ['membership', ROOT.id, RELAY],
        ['group', CHAN.id, RELAY, 'Channel']
      ])
    ]);
    expect(map.get(ROOT.id)).toBe(COMMUNITY);
    expect(map.get(CHAN.id)).toBe(COMMUNITY);
  });

  it('first community wins on a conflicting group id', () => {
    const map = groupToCommunityMap([
      community(COMMUNITY, [['membership', ROOT.id, RELAY]]),
      community(COMMUNITY2, [['membership', ROOT.id, RELAY]])
    ]);
    expect(map.get(ROOT.id)).toBe(COMMUNITY);
  });

  it('ignores malformed events and invalid relay urls', () => {
    const map = groupToCommunityMap([
      null,
      { kind: 10222, pubkey: COMMUNITY, tags: [['membership', 'x', 'not-a-relay']] },
      { kind: 10222 }
    ]);
    expect(map.size).toBe(0);
  });
});

describe('summarizeJoinRequestAlert', () => {
  /** @param {string} groupId @param {number} createdAt @param {string} [id] */
  const row = (groupId, createdAt, id = `${groupId}-${createdAt}`) => ({
    id,
    pubkey: APPLICANT,
    reason: '',
    createdAt,
    groupId
  });

  it('counts only rows whose group maps to a community, grouped per community, newest first', () => {
    const groupToCommunity = new Map([
      [ROOT.id, COMMUNITY],
      ['other-root', COMMUNITY2]
    ]);
    const summary = summarizeJoinRequestAlert({
      pending: [row(ROOT.id, 100), row('other-root', 300), row(ROOT.id, 200), row('unmapped', 400)],
      groupToCommunity
    });
    expect(summary.count).toBe(3);
    expect(summary.communities).toEqual([
      { pubkey: COMMUNITY2, count: 1, newest: 300 },
      { pubkey: COMMUNITY, count: 2, newest: 200 }
    ]);
  });

  it('is empty when nothing is pending', () => {
    const summary = summarizeJoinRequestAlert({ pending: [], groupToCommunity: new Map() });
    expect(summary.count).toBe(0);
    expect(summary.communities).toEqual([]);
  });
});

describe('readAllDismissedJoinRequests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('unions the dismissed sets of every community', () => {
    writeDismissedJoinRequests(COMMUNITY, new Set(['req1']));
    writeDismissedJoinRequests(COMMUNITY2, new Set(['req2', 'req3']));
    expect(readAllDismissedJoinRequests()).toEqual(new Set(['req1', 'req2', 'req3']));
  });

  it('skips unrelated and malformed keys', () => {
    localStorage.setItem('groups/other', JSON.stringify(['nope']));
    localStorage.setItem(dismissedJoinRequestsKey(COMMUNITY), 'not-json');
    expect(readAllDismissedJoinRequests()).toEqual(new Set());
  });
});
