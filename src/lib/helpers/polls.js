/**
 * Pure aggregation helpers for NIP-88 polls (kind 1068) and responses (kind 1018).
 */
import { getPollResponseVotes } from 'applesauce-common/helpers';
import { getTagValue } from 'applesauce-core/helpers';

/**
 * @typedef {Object} OptionTally
 * @property {number} count
 * @property {string[]} voters - pubkeys (deduped, in latest-vote order)
 */

/**
 * @typedef {Object} PollTally
 * @property {Map<string, OptionTally>} byOption - keyed by option id
 * @property {number} totalVoters - distinct accepted voter pubkeys
 * @property {string[] | null} userVote - active user's accepted option ids, or null
 */

/**
 * Compute the tally for a poll given its response events.
 * Implements NIP-88 rules:
 *  - One vote per pubkey (latest by created_at; ties broken lex by event id).
 *  - Responses with created_at > endsAt are ignored.
 *  - getPollResponseVotes() validates option ids and applies single/multi rules.
 *
 * @param {any} poll - kind 1068 event
 * @param {any[]} responses - kind 1018 events
 * @param {string} [activeUserPubkey]
 * @returns {PollTally}
 */
export function tallyPollVotes(poll, responses, activeUserPubkey) {
  const optionIds = (poll.tags || [])
    .filter((/** @type {string[]} */ t) => t[0] === 'option')
    .map((/** @type {string[]} */ t) => t[1]);

  /** @type {Map<string, OptionTally>} */
  const byOption = new Map();
  for (const id of optionIds) byOption.set(id, { count: 0, voters: [] });

  const endsAtRaw = getTagValue(poll, 'endsAt');
  const endsAt = endsAtRaw ? Number(endsAtRaw) : Infinity;

  // Latest accepted response per pubkey.
  /** @type {Map<string, any>} */
  const latestByPubkey = new Map();
  for (const r of responses) {
    if (r.created_at > endsAt) continue;
    const existing = latestByPubkey.get(r.pubkey);
    if (
      !existing ||
      r.created_at > existing.created_at ||
      (r.created_at === existing.created_at && r.id > existing.id)
    ) {
      latestByPubkey.set(r.pubkey, r);
    }
  }

  /** @type {string[] | null} */
  let userVote = null;
  let totalVoters = 0;

  for (const [pubkey, response] of latestByPubkey) {
    const valid = getPollResponseVotes(poll, response);
    if (!valid || valid.length === 0) continue;
    totalVoters++;
    for (const optionId of valid) {
      const slot = byOption.get(optionId);
      if (!slot) continue; // option id not in poll — defensive
      slot.count++;
      slot.voters.push(pubkey);
    }
    if (activeUserPubkey && pubkey === activeUserPubkey) {
      userVote = valid;
    }
  }

  return { byOption, totalVoters, userVote };
}

/**
 * Generate a 9-char base36 option id (e.g. "qj518h583").
 * @returns {string}
 */
export function generateOptionId() {
  return Math.random().toString(36).slice(2, 11).padEnd(9, '0');
}

/**
 * Extract all `relay` tag values from a NIP-88 poll event.
 * @param {{ tags?: any[][] }} poll
 * @returns {string[]}
 */
export function extractPollRelayTags(poll) {
  return (poll.tags || [])
    .filter((t) => Array.isArray(t) && t[0] === 'relay' && typeof t[1] === 'string')
    .map((t) => t[1]);
}
