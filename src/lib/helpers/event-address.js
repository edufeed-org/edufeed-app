/**
 * `kind:pubkey:d` coordinates of events. Pure: never applesauce's
 * getReplaceableAddress(), which caches on the event (CLAUDE.md, "Applesauce
 * Functions That Mutate").
 */

/**
 * `kind:pubkey:d` for addressable kinds (30000–39999) carrying a `d` tag,
 * else null.
 * @param {any} event
 * @returns {string | null}
 */
export function eventAddress(event) {
  if (!event || typeof event.kind !== 'number' || !event.pubkey) return null;
  if (event.kind < 30000 || event.kind >= 40000) return null;
  const d = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
  if (d === undefined) return null;
  return `${event.kind}:${event.pubkey}:${d}`;
}

/**
 * `kind:pubkey:d` of an event the caller knows is addressable — no kind check,
 * a missing `d` tag counts as the empty identifier.
 * @param {{ kind: number, pubkey: string, tags?: string[][] }} event
 * @returns {string}
 */
export function eventCoordinate(event) {
  const d = event.tags?.find((t) => t[0] === 'd')?.[1] ?? '';
  return `${event.kind}:${event.pubkey}:${d}`;
}
