/** @vitest-environment node */
// pendingJoinRequests — the admin queue behind "Beitrittsanfragen"
// (MembershipPane). NIP-29's spec-native application flow: a bare kind-9021
// (content = free-text reason) sits stored on the relay of a closed group
// until an admin approves with put-user. This helper turns the raw 9021s
// into the queue: newest per applicant, minus everyone already on the
// roster, minus locally dismissed requests.
import { describe, it, expect } from 'vitest';
import { pendingJoinRequests } from '$lib/groups/join-requests.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

/** @param {string} pubkey @param {number} created_at @param {string} [content] */
const req = (pubkey, created_at, content = '') => ({
  id: `${pubkey.slice(0, 4)}-${created_at}`,
  kind: 9021,
  pubkey,
  created_at,
  content,
  tags: [['h', 'root1']]
});

describe('pendingJoinRequests', () => {
  it('keeps the newest request per applicant, sorted newest first', () => {
    const rows = pendingJoinRequests({
      events: [req(A, 100, 'old'), req(B, 300, 'hi'), req(A, 200, 'new')],
      members: new Set(),
      dismissed: new Set()
    });
    expect(rows.map((r) => [r.pubkey, r.reason])).toEqual([
      [B, 'hi'],
      [A, 'new']
    ]);
  });

  it('drops applicants already on the roster — approval empties the queue by itself', () => {
    const rows = pendingJoinRequests({
      events: [req(A, 100), req(B, 200)],
      members: new Set([A]),
      dismissed: new Set()
    });
    expect(rows.map((r) => r.pubkey)).toEqual([B]);
  });

  it('drops dismissed request ids, but a NEWER request from the same person resurfaces', () => {
    const dismissedReq = req(C, 100, 'first try');
    const rows = pendingJoinRequests({
      events: [dismissedReq, req(C, 200, 'second try')],
      members: new Set(),
      dismissed: new Set([dismissedReq.id])
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('second try');

    const allDismissed = pendingJoinRequests({
      events: [dismissedReq],
      members: new Set(),
      dismissed: new Set([dismissedReq.id])
    });
    expect(allDismissed).toEqual([]);
  });

  it('never throws on malformed events (untrusted network input)', () => {
    const rows = pendingJoinRequests({
      events: /** @type {any} */ ([null, { kind: 9021 }, req(A, 100)]),
      members: new Set(),
      dismissed: new Set()
    });
    expect(rows.map((r) => r.pubkey)).toEqual([A]);
  });
});
