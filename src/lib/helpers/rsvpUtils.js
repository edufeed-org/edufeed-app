/**
 * RSVP Utilities
 * Shared helper functions for processing and transforming RSVP data
 */
import { getRSVPStatus } from 'applesauce-common/helpers';

/**
 * Transform raw RSVP events into grouped data structure
 * Handles deduplication (most recent RSVP per user), grouping by status, and user RSVP detection
 *
 * @param {any[]} rsvps - Array of raw RSVP events from eventStore
 * @param {string | null} [userPubkey=null] - Current user's pubkey to detect their RSVP
 * @returns {{
 *   accepted: any[],
 *   tentative: any[],
 *   declined: any[],
 *   totalCount: number,
 *   userRsvp: { status: string, event: any } | null
 * }}
 */
export function transformRsvps(rsvps, userPubkey = null) {
  const accepted = [];
  const tentative = [];
  const declined = [];
  let userRsvp = null;

  // Deduplicate RSVPs - keep only the most recent per user
  const rsvpMap = new Map();
  for (const rsvp of rsvps) {
    const existing = rsvpMap.get(rsvp.pubkey);
    if (!existing || rsvp.created_at > existing.created_at) {
      rsvpMap.set(rsvp.pubkey, rsvp);
    }
  }

  // Group deduplicated RSVPs by status. NIP-52 requires `status` to be one
  // of accepted/declined/tentative; an RSVP with no status tag (or an
  // invalid one) is skipped rather than defaulted to "accepted".
  for (const rsvp of rsvpMap.values()) {
    const status = getRSVPStatus(rsvp);
    if (!status) continue;

    // Check if this is the user's RSVP
    if (userPubkey && rsvp.pubkey === userPubkey) {
      userRsvp = { status, event: rsvp };
    }

    // Group by status
    if (status === 'accepted') {
      accepted.push(rsvp);
    } else if (status === 'tentative') {
      tentative.push(rsvp);
    } else if (status === 'declined') {
      declined.push(rsvp);
    }
  }

  return {
    accepted,
    tentative,
    declined,
    totalCount: accepted.length + tentative.length + declined.length,
    userRsvp
  };
}
