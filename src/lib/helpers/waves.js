import { publishReaction } from '$lib/helpers/reactions.js';

const COOLDOWN_SECONDS = 24 * 60 * 60;

/**
 * Check if a kind 7 event is a wave (reaction targeting a kind 0 profile).
 * @param {any} event
 * @returns {boolean}
 */
export function isWave(event) {
  if (!event || event.kind !== 7) return false;
  return event.tags?.some((/** @type {string[]} */ t) => t[0] === 'k' && t[1] === '0') ?? false;
}

/**
 * Publish a wave to a user's profile.
 * @param {any} profileEvent - The kind 0 profile event
 * @returns {Promise<any>}
 */
export async function publishWave(profileEvent) {
  return publishReaction(profileEvent, '👋');
}

/**
 * Check if the user can wave (24h cooldown).
 * @param {any[]} reactions - Array of reaction events for the target profile
 * @param {string} myPubkey - The current user's pubkey
 * @returns {{ canWave: boolean, cooldownUntil?: number }}
 */
export function canWave(reactions, myPubkey) {
  const myWaves = reactions.filter((e) => e.pubkey === myPubkey && isWave(e));

  if (myWaves.length === 0) return { canWave: true };

  const mostRecent = myWaves.reduce(
    (latest, e) => (e.created_at > latest.created_at ? e : latest),
    myWaves[0]
  );

  const now = Math.floor(Date.now() / 1000);
  const cooldownUntil = mostRecent.created_at + COOLDOWN_SECONDS;

  if (cooldownUntil > now) {
    return { canWave: false, cooldownUntil };
  }

  return { canWave: true };
}
