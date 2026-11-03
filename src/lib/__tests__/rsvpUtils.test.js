/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { transformRsvps } from '$lib/helpers/rsvpUtils.js';

/**
 * NIP-52: the RSVP `status` tag is required and must be one of
 * accepted/declined/tentative. An RSVP with no status tag, or an invalid
 * one, must not be counted as an attendee.
 */

/**
 * @param {string} pubkey
 * @param {string[][]} tags
 * @param {number} [created_at]
 */
function makeRsvp(pubkey, tags, created_at = 1000) {
  return { id: `${pubkey}-id`, pubkey, created_at, tags, kind: 31925 };
}

describe('transformRsvps', () => {
  it('does not count an RSVP with no status tag as accepted', () => {
    const rsvp = makeRsvp('alice', [['e', 'event1']]);
    const result = transformRsvps([rsvp]);

    expect(result.totalCount).toBe(0);
    expect(result.accepted).not.toContain(rsvp);
    expect(result.tentative).not.toContain(rsvp);
    expect(result.declined).not.toContain(rsvp);
  });

  it('ignores RSVPs with an invalid status value (wrong case or unknown value)', () => {
    const uppercase = makeRsvp('bob', [['status', 'ACCEPTED']]);
    const unknown = makeRsvp('carol', [['status', 'requested']]);
    const result = transformRsvps([uppercase, unknown]);

    expect(result.totalCount).toBe(0);
    expect(result.accepted).toHaveLength(0);
    expect(result.tentative).toHaveLength(0);
    expect(result.declined).toHaveLength(0);
  });

  it('still counts RSVPs with a valid status', () => {
    const accepted = makeRsvp('dave', [['status', 'accepted']]);
    const tentative = makeRsvp('erin', [['status', 'tentative']]);
    const declined = makeRsvp('frank', [['status', 'declined']]);
    const result = transformRsvps([accepted, tentative, declined]);

    expect(result.totalCount).toBe(3);
    expect(result.accepted).toContain(accepted);
    expect(result.tentative).toContain(tentative);
    expect(result.declined).toContain(declined);
  });

  it('returns userRsvp as null when the user is the one with a status-less RSVP', () => {
    const rsvp = makeRsvp('alice', [['e', 'event1']]);
    const result = transformRsvps([rsvp], 'alice');

    expect(result.userRsvp).toBeNull();
  });

  it('still reports userRsvp for a valid status', () => {
    const rsvp = makeRsvp('alice', [['status', 'tentative']]);
    const result = transformRsvps([rsvp], 'alice');

    expect(result.userRsvp).toEqual({ status: 'tentative', event: rsvp });
  });
});
