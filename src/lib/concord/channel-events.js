// NIP-52 calendar events in Concord channels (CORD.md "Calendar Events").
//
// Kind 31922 (date-based, YYYY-MM-DD) / 31923 (time-based, unix seconds)
// rumors sealed into the chat plane. These are RUMORS, so there is no
// `a`-coordinate: addressable identity is (kind, author, `d`) with the newest
// created_at winning, and RSVPs (kind 31925) reference the event by RUMOR id
// via an `e` tag with a `status` tag — semantics matched to Armada's shared
// calendar module (armada src/lib/calendar.ts); implementation our own.
//
// Pure module — no package imports (src/lib/concord SSR convention).

/**
 * @typedef {'accepted'|'declined'|'tentative'} RsvpStatus
 * @typedef {{id: string, kind: number, pubkey: string, d: string, title: string,
 *            start: string, end: string | undefined, location: string | undefined,
 *            dateBased: boolean}} ChannelCalendarEvent
 * @typedef {{pubkey: string, status: RsvpStatus, ms: number}} RsvpVote
 */

/** @param {{tags?: string[][]}} rumor @param {string} name */
function tagValue(rumor, name) {
  return rumor.tags?.find((t) => t[0] === name)?.[1];
}

/**
 * An event's start as an epoch second (date-based starts parse at UTC
 * midnight, matching Armada). 0 for unparseable starts.
 * @param {ChannelCalendarEvent} event
 */
export function startEpoch(event) {
  if (!event.dateBased) return Number(event.start) || 0;
  const ms = Date.parse(`${event.start}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

/**
 * An event's end as an epoch second, falling back to its start.
 * @param {ChannelCalendarEvent} event
 */
export function endEpoch(event) {
  if (!event.end) return startEpoch(event);
  if (!event.dateBased) return Number(event.end) || startEpoch(event);
  const ms = Date.parse(`${event.end}T00:00:00Z`);
  return Number.isNaN(ms) ? startEpoch(event) : Math.floor(ms / 1000);
}

/**
 * True while the event has not yet ended (upcoming or in progress).
 * @param {ChannelCalendarEvent} event
 * @param {number} [now]
 */
export function isUpcoming(event, now = Math.floor(Date.now() / 1000)) {
  return endEpoch(event) >= now;
}

/**
 * Parse a batch of 31922/31923 rumors: newest per (kind, author, d) wins,
 * malformed ones (no title or start) are dropped, sorted soonest-first.
 * @param {any[]} rumors
 * @returns {ChannelCalendarEvent[]}
 */
export function parseChannelEvents(rumors) {
  const newest = new Map();
  for (const rumor of rumors) {
    const d = tagValue(rumor, 'd') ?? '';
    const coord = `${rumor.kind}:${rumor.pubkey}:${d}`;
    const existing = newest.get(coord);
    if (!existing || (existing.created_at ?? 0) < (rumor.created_at ?? 0)) {
      newest.set(coord, rumor);
    }
  }

  /** @type {ChannelCalendarEvent[]} */
  const events = [];
  for (const rumor of newest.values()) {
    const title = tagValue(rumor, 'title');
    const start = tagValue(rumor, 'start');
    if (!title || !start) continue;
    events.push({
      id: rumor.id,
      kind: rumor.kind,
      pubkey: rumor.pubkey,
      d: tagValue(rumor, 'd') ?? '',
      title,
      start,
      end: tagValue(rumor, 'end'),
      location: tagValue(rumor, 'location'),
      dateBased: rumor.kind === 31922
    });
  }
  events.sort((a, b) => startEpoch(a) - startEpoch(b));
  return events;
}

/**
 * Bucket kind-31925 RSVP rumors by the event rumor they `e`-reference.
 * Invalid statuses are dropped; `ms` falls back to created_at seconds.
 * @param {any[]} rsvpRumors
 * @returns {Map<string, RsvpVote[]>}
 */
export function collectRsvps(rsvpRumors) {
  const byEvent = new Map();
  for (const rumor of rsvpRumors) {
    const target = tagValue(rumor, 'e');
    const status = tagValue(rumor, 'status');
    if (!target) continue;
    if (status !== 'accepted' && status !== 'declined' && status !== 'tentative') continue;
    let list = byEvent.get(target);
    if (!list) byEvent.set(target, (list = []));
    list.push({
      pubkey: rumor.pubkey,
      status,
      ms: rumor.ms ?? (rumor.created_at ?? 0) * 1000
    });
  }
  return byEvent;
}

/**
 * Deterministic RSVP tally: latest per pubkey wins, bucketed by status,
 * with the current user's own status surfaced.
 * @param {RsvpVote[]} votes
 * @param {string | undefined} selfPubkey
 * @returns {{accepted: string[], declined: string[], tentative: string[], mine: RsvpStatus | undefined}}
 */
export function tallyRsvps(votes, selfPubkey) {
  const latest = new Map();
  for (const vote of votes) {
    const existing = latest.get(vote.pubkey);
    if (!existing || vote.ms > existing.ms) latest.set(vote.pubkey, vote);
  }
  const out = {
    accepted: /** @type {string[]} */ ([]),
    declined: /** @type {string[]} */ ([]),
    tentative: /** @type {string[]} */ ([]),
    mine: /** @type {RsvpStatus | undefined} */ (undefined)
  };
  for (const vote of /** @type {Iterable<RsvpVote>} */ (latest.values())) {
    out[vote.status].push(vote.pubkey);
    if (selfPubkey && vote.pubkey === selfPubkey) out.mine = vote.status;
  }
  return out;
}

/**
 * Kind-31925 RSVP template (channel/epoch binding appended by sendEvent).
 * @param {string} eventRumorId
 * @param {RsvpStatus} status
 */
export function buildRsvpTemplate(eventRumorId, status) {
  return {
    kind: 31925,
    content: '',
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['e', eventRumorId],
      ['status', status]
    ]
  };
}
