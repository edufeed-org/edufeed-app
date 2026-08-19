/** @vitest-environment node */
// pendingJoinRequests — the admin queue behind "Beitrittsanfragen"
// (MembershipPane / MembersView). NIP-29's spec-native application flow: a
// bare kind-9021 (content = free-text reason) sits stored on the relay of a
// closed group until an admin approves with put-user. This helper turns the
// raw 9021s into the queue: newest per (applicant, group knocked on), minus
// whoever is already a member of THAT group, minus locally dismissed
// requests.
//
// Group-aware (final-review fix, 2026-08-19): an existing community member
// who knocks on a closed CHANNEL is not a member of that channel yet — a
// root-only membership check dropped their request before any admin ever
// saw it (the relay has no parent-member auto-admit patch). `membersByGroup`
// now carries a roster PER group (root + every channel); a group with an
// UNKNOWN roster (no entry in the map) treats the requester as not-a-member
// — overstating the queue is the safe direction, never silently dropping a
// real request.
import { describe, it, expect } from 'vitest';
import { pendingJoinRequests } from '$lib/groups/join-requests.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const ROOT = 'root1';
const CHAN = 'chan1';

/** @param {string} pubkey @param {number} created_at @param {{content?: string, id?: string, groupId?: string}} [opts] */
const req = (pubkey, created_at, opts = {}) => ({
  id: opts.id ?? `${pubkey.slice(0, 4)}-${created_at}`,
  kind: 9021,
  pubkey,
  created_at,
  content: opts.content ?? '',
  tags: [['h', opts.groupId ?? ROOT]]
});

describe('pendingJoinRequests', () => {
  it('keeps the newest request per (applicant, group), sorted newest first', () => {
    const rows = pendingJoinRequests({
      events: [
        req(A, 100, { content: 'old' }),
        req(B, 300, { content: 'hi' }),
        req(A, 200, { content: 'new' })
      ],
      membersByGroup: new Map(),
      rootId: ROOT,
      dismissed: new Set()
    });
    expect(rows.map((r) => [r.pubkey, r.reason])).toEqual([
      [B, 'hi'],
      [A, 'new']
    ]);
  });

  it('drops applicants already on the roster of the group they knocked on — approval empties the queue by itself', () => {
    const rows = pendingJoinRequests({
      events: [req(A, 100), req(B, 200)],
      membersByGroup: new Map([[ROOT, new Set([A])]]),
      rootId: ROOT,
      dismissed: new Set()
    });
    expect(rows.map((r) => r.pubkey)).toEqual([B]);
  });

  it('drops dismissed request ids, but a NEWER request from the same person resurfaces', () => {
    const dismissedReq = req(C, 100, { content: 'first try' });
    const rows = pendingJoinRequests({
      events: [dismissedReq, req(C, 200, { content: 'second try' })],
      membersByGroup: new Map(),
      rootId: ROOT,
      dismissed: new Set([dismissedReq.id])
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('second try');

    const allDismissed = pendingJoinRequests({
      events: [dismissedReq],
      membersByGroup: new Map(),
      rootId: ROOT,
      dismissed: new Set([dismissedReq.id])
    });
    expect(allDismissed).toEqual([]);
  });

  it('never throws on malformed events (untrusted network input)', () => {
    const rows = pendingJoinRequests({
      events: /** @type {any} */ ([null, { kind: 9021 }, req(A, 100)]),
      membersByGroup: new Map(),
      rootId: ROOT,
      dismissed: new Set()
    });
    expect(rows.map((r) => r.pubkey)).toEqual([A]);
  });

  // A root member who is NOT (yet) a member of a channel must still see
  // their own channel-knock in the queue — the exact bug this fix closes.
  it('shows a root member knocking on a channel they are not a member of', () => {
    const rows = pendingJoinRequests({
      events: [req(A, 100, { groupId: CHAN })],
      membersByGroup: new Map([
        [ROOT, new Set([A])],
        [CHAN, new Set()]
      ]),
      rootId: ROOT,
      dismissed: new Set()
    });
    expect(rows.map((r) => r.pubkey)).toEqual([A]);
  });

  it('drops a request from someone already a member of the SPECIFIC channel they knocked on', () => {
    const rows = pendingJoinRequests({
      events: [req(A, 100, { groupId: CHAN })],
      membersByGroup: new Map([
        [ROOT, new Set()],
        [CHAN, new Set([A])]
      ]),
      rootId: ROOT,
      dismissed: new Set()
    });
    expect(rows).toEqual([]);
  });

  it('shows a request for a group whose roster is unknown (not yet answered) — overstating is the safe direction', () => {
    const rows = pendingJoinRequests({
      events: [req(A, 100, { groupId: CHAN })],
      // CHAN has no entry at all — roster not (yet) known.
      membersByGroup: new Map([[ROOT, new Set([A])]]),
      rootId: ROOT,
      dismissed: new Set()
    });
    expect(rows.map((r) => r.pubkey)).toEqual([A]);
  });

  it('per-(pubkey, group) dedupe keeps both a root request and a channel request from the same person', () => {
    const rows = pendingJoinRequests({
      events: [
        req(A, 100, { id: 'root-req', groupId: ROOT }),
        req(A, 200, { id: 'chan-req', groupId: CHAN })
      ],
      membersByGroup: new Map(),
      rootId: ROOT,
      dismissed: new Set()
    });
    expect(rows.map((r) => [r.groupId, r.id]).sort()).toEqual(
      [
        [ROOT, 'root-req'],
        [CHAN, 'chan-req']
      ].sort()
    );
  });

  it('falls back to rootId when the h-tag is missing, for both grouping and membership', () => {
    const event = req(A, 100, { groupId: ROOT });
    // Strip the h tag to simulate a malformed/legacy request with no group.
    event.tags = [];
    const rows = pendingJoinRequests({
      events: [event],
      membersByGroup: new Map([[ROOT, new Set([A])]]),
      rootId: ROOT,
      dismissed: new Set()
    });
    // A already a member of the fallback (root) group — dropped.
    expect(rows).toEqual([]);
  });
});
