// Per-message memo for the call chat's parsed bodies. CallChatPanel keeps
// one map id → parsed body that it rebuilds whenever the chat or a profile
// changes; this carries the entries over whose key (the names a message
// depends on) is unchanged, so each message is parsed once and not on
// every rebuild.

/** @type {WeakMap<object, string>} parsed value → the key it was built for */
const keyOf = new WeakMap();

/**
 * @template {{ id: string }} T
 * @template {object} V
 * @param {Map<string, V>} prev the map of the previous rebuild
 * @param {T[]} items
 * @param {{ key: (item: T) => string, parse: (item: T) => V }} by
 * @returns {Map<string, V>} a new map holding one value per item
 */
export function reuseParsed(prev, items, { key, parse }) {
  /** @type {Map<string, V>} */
  const next = new Map();
  for (const item of items) {
    const k = key(item);
    const old = prev.get(item.id);
    if (old !== undefined && keyOf.get(old) === k) {
      next.set(item.id, old);
      continue;
    }
    const value = parse(item);
    keyOf.set(value, k);
    next.set(item.id, value);
  }
  return next;
}
