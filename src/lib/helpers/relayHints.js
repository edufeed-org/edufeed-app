/**
 * Relay-hint prioritization for NIP-19 encoding.
 *
 * A relay hint is only useful if the relay actually holds the event. We never
 * invent a hint for a relay we did not observe the event on — that was the
 * original "Event not found" bug, where re-encoding leaned on lookup relays
 * that didn't have the data. Among the relays we *did* see, we surface durable
 * (app-managed) ones first: they outlive transient public relays, so a hint
 * pointing at one is more likely to still resolve later.
 */

const norm = (relay) => relay.replace(/\/+$/, '');

/**
 * Order seen relays so durable ones come first, then cap to `limit`.
 * Returns the original (un-normalized) seen values — never a relay the event
 * was not seen on.
 *
 * @param {Iterable<string> | undefined} seenRelays - relays the event was observed on
 * @param {Iterable<string> | undefined} durableRelays - app-managed relays to prefer
 * @param {number} [limit=3] - max hints to emit
 * @returns {string[]}
 */
export function prioritizeRelayHints(seenRelays, durableRelays, limit = 3) {
  const seen = Array.from(seenRelays ?? []);
  const durable = new Set(Array.from(durableRelays ?? []).map(norm));
  const preferred = seen.filter((r) => durable.has(norm(r)));
  const rest = seen.filter((r) => !durable.has(norm(r)));
  return [...preferred, ...rest].slice(0, limit);
}
