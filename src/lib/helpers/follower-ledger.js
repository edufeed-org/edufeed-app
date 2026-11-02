/**
 * Per-device ledger of who follows the user, for "X folgt dir jetzt" in the
 * inbox (issue 891be310) without false alarms.
 *
 * Contact lists (kind 3) are replaceable: a follower who follows anyone else
 * republishes theirs — new id, new created_at, still p-tagging the user. So
 * "a kind 3 that names me" is not "a new follower". The ledger remembers
 * everyone already seen; before the first full look (`seeded`) everyone is
 * recorded silently (0), so a first login does not announce years of old
 * followers. After that, only a list created after the moment of seeding is
 * a new follow: an older list that turns up later (another surface such as
 * the profile's follower list loads it from other relays) is a past follow
 * and recorded silently too. A new follower is recorded once, at the
 * created_at of the first list that named the user, and the inbox item
 * derived from it is stable: same id, same time, however often the list is
 * republished.
 */

/** @typedef {{ seeded: boolean, seededAt: number, known: Record<string, number> }} FollowerLedger */

/** @returns {FollowerLedger} */
export function emptyLedger() {
  return { seeded: false, seededAt: 0, known: {} };
}

/**
 * @param {FollowerLedger} ledger
 * @param {number} now - unix seconds; lists created up to here are past follows
 * @returns {FollowerLedger}
 */
export function markSeeded(ledger, now) {
  return ledger.seeded ? ledger : { ...ledger, seeded: true, seededAt: now };
}

/**
 * Record the authors of contact lists that name `me`. Returns the same
 * object when nothing changed, so callers can skip persisting.
 * @param {FollowerLedger} ledger
 * @param {Iterable<{ pubkey: string, created_at: number, tags: string[][] }>} events
 * @param {string} me
 * @returns {FollowerLedger}
 */
export function recordFollowers(ledger, events, me) {
  /** @type {Record<string, number> | null} */
  let known = null;
  for (const event of events) {
    if (event.pubkey === me || event.pubkey in ledger.known) continue;
    if (known && event.pubkey in known) continue;
    if (!event.tags.some((t) => t[0] === 'p' && t[1] === me)) continue;
    known ??= { ...ledger.known };
    known[event.pubkey] =
      ledger.seeded && event.created_at > ledger.seededAt ? event.created_at : 0;
  }
  return known ? { ...ledger, known } : ledger;
}

/**
 * Inbox items for followers first seen after seeding, within `windowSeconds`
 * of `now`, newest first. Synthetic, unsigned events: id and created_at never
 * change for a follower, so read state and OS toasts stay put.
 * @param {FollowerLedger} ledger
 * @param {string} me
 * @param {number} now - unix seconds
 * @param {number} [windowSeconds] - default 30 days
 */
export function followerNotifications(ledger, me, now, windowSeconds = 30 * 24 * 3600) {
  return Object.entries(ledger.known)
    .filter(([, at]) => at > 0 && now - at <= windowSeconds)
    .sort((a, b) => b[1] - a[1])
    .map(([pubkey, at]) => ({
      id: `follow:${pubkey}`,
      kind: 3,
      pubkey,
      created_at: at,
      tags: [['p', me]],
      content: ''
    }));
}

/**
 * @param {string | null} raw - localStorage value
 * @returns {FollowerLedger}
 */
export function parseLedger(raw) {
  if (!raw) return emptyLedger();
  try {
    const value = JSON.parse(raw);
    if (typeof value?.seeded !== 'boolean' || typeof value?.known !== 'object' || !value.known) {
      return emptyLedger();
    }
    const seededAt = typeof value.seededAt === 'number' ? value.seededAt : 0;
    /** @type {Record<string, number>} */
    const known = {};
    for (const [pk, at] of Object.entries(value.known)) {
      if (/^[0-9a-f]{64}$/.test(pk) && typeof at === 'number') known[pk] = at;
    }
    return { seeded: value.seeded, seededAt, known };
  } catch {
    return emptyLedger();
  }
}
