/**
 * NKBIP-01 publication trees (kind 30040).
 *
 * A publication index references its sections with `a` tags; a section can
 * itself be a 30040 index (a chapter). Lists of an author's publications
 * show each book once, with its chapters underneath, instead of every
 * chapter as a publication of its own.
 *
 * Pure on purpose: callers use it inside `$derived`, where applesauce's
 * caching address helpers would mutate the events.
 */
import { eventCoordinate } from '$lib/helpers/event-address.js';

const KIND = 30040;

/**
 * Group publications into top-level entries with their chapters.
 *
 * - A chapter is a 30040 by the SAME author that a loaded 30040 references
 *   with an `a` tag; it is listed under its first referencing parent (in
 *   input order), in that parent's a-tag order, and not at top level.
 * - A chapter whose parent is not loaded stays top-level.
 * - Deeper levels stay with their direct parent (a section of a part is not
 *   repeated under the book); its page lists them.
 * - Cycles and self-references never hide everything: every event stays
 *   reachable from a top-level entry.
 *
 * @template {{ id?: string, kind: number, pubkey: string, created_at: number, tags?: string[][] }} E
 * @param {E[] | null | undefined} events
 * @returns {Array<{ event: E, chapters: E[] }>}
 */
export function groupPublicationChapters(events) {
  const list = (events || []).filter((e) => e?.kind === KIND);

  // Newest revision per coordinate.
  /** @type {Map<string, E>} */
  const byCoord = new Map();
  for (const event of list) {
    const coord = eventCoordinate(event);
    const seen = byCoord.get(coord);
    if (!seen || event.created_at > seen.created_at) byCoord.set(coord, event);
  }
  const unique = list.filter((e) => byCoord.get(eventCoordinate(e)) === e);

  /** @type {Map<E, E[]>} direct chapters per event, in a-tag order */
  const children = new Map();
  for (const event of unique) {
    /** @type {E[]} */
    const kids = [];
    for (const tag of event.tags || []) {
      if (tag[0] !== 'a' || typeof tag[1] !== 'string') continue;
      if (!tag[1].startsWith(`${KIND}:${event.pubkey}:`)) continue;
      const child = byCoord.get(tag[1]);
      if (child && child !== event && !kids.includes(child)) kids.push(child);
    }
    children.set(event, kids);
  }

  /** @type {Map<E, E>} first parent per chapter */
  const parentOf = new Map();
  for (const event of unique) {
    for (const child of children.get(event) || []) {
      if (!parentOf.has(child)) parentOf.set(child, event);
    }
  }

  /** @type {E[]} */
  const top = unique.filter((e) => !parentOf.has(e));

  // Cycle break: an event no top-level entry reaches (x → y → x) promotes
  // the first such event, in input order, to the top level.
  const reached = new Set();
  /** @param {E} root */
  const walk = (root) => {
    const stack = [root];
    while (stack.length) {
      const e = /** @type {E} */ (stack.pop());
      if (reached.has(e)) continue;
      reached.add(e);
      stack.push(...(children.get(e) || []));
    }
  };
  top.forEach(walk);
  for (const event of unique) {
    if (reached.has(event)) continue;
    top.push(event);
    walk(event);
  }
  const topSet = new Set(top);

  return unique
    .filter((e) => topSet.has(e))
    .map((event) => ({
      event,
      chapters: (children.get(event) || []).filter(
        (c) => !topSet.has(c) && parentOf.get(c) === event
      )
    }));
}
