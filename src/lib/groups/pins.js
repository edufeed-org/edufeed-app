// NIP-29 pinned messages — the pure read side.
//
// A group's pin list lives on its relay. Moderators publish kind 9010
// `update-pin-list` carrying the FULL list (`e` tags for regular events, `a`
// for addressables); the relay applies it and regenerates kind 39005 "group
// pinned events" (`d` = group id), signed with its own key. Both shapes carry
// the whole list, so whichever is newest is the truth — and on a relay that
// stores the accepted 9010 but never emits a 39005 (groups.edufeed.org,
// pyramid edufeed-v1.23, probed 2026-11-03: a moderator's 9010 is stored and
// readable, a member's is refused, no 39005 appears) the newest stored 9010 IS
// the list. A relay only ever stores the 9010s it accepted, so reading them
// back is as authoritative as the 39005 it would have derived from them.
//
// The chat itself pins only messages (kind 9, `e` entries); meetings (kind
// 31923, addressable) are deliberately not pinnable from here, like they are
// not deletable from the chat. But NIP-29 lets a list carry addressable
// events as `a` entries, and every list we publish is the FULL list — so an
// `a` entry another client pinned is read, kept in its place and written
// back untouched (`getPinnedRefs` / `resolvePinnedRefs`); only the `e` side
// (`getPinnedIds` / `resolvePinnedIds`) is shown.

/** NIP-29 `update-pin-list` moderation event. */
export const UPDATE_PIN_LIST_KIND = 9010;
/** NIP-29 relay-generated "group pinned events" (d = group id). */
export const PINNED_EVENTS_KIND = 39005;
/**
 * App-side cap. NIP-29 lets the relay limit the list and says nothing
 * else; CORD-04 §7 caps Concord pins at 25, so the two lanes agree.
 */
export const MAX_PINS = 25;

const HEX64 = /^[0-9a-f]{64}$/;
/** `<kind>:<pubkey>:<d>` — the d-identifier may be empty. */
const COORDINATE = /^\d+:[0-9a-f]{64}:/;

/**
 * One entry of a pin list: a regular event (`e`, id) or an addressable one
 * (`a`, `kind:pubkey:d` coordinate).
 * @typedef {{type: 'e' | 'a', value: string}} PinRef
 */

/**
 * The entries of a 39005 or 9010, in list order, deduped and validated — tag
 * values are network input and a repeated value would crash a keyed
 * `{#each}`.
 * @param {{tags?: string[][]} | null | undefined} event
 * @returns {PinRef[]}
 */
export function getPinnedRefs(event) {
  /** @type {PinRef[]} */
  const refs = [];
  const seen = new Set();
  for (const tag of event?.tags ?? []) {
    const type = tag[0];
    const value = tag[1];
    if ((type !== 'e' && type !== 'a') || typeof value !== 'string') continue;
    if (type === 'e' ? !HEX64.test(value) : !COORDINATE.test(value)) continue;
    const key = `${type}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ type, value });
  }
  return refs;
}

/**
 * The pinned event ids (the `e` entries) of a 39005 or 9010, in list order.
 * @param {{tags?: string[][]} | null | undefined} event
 * @returns {string[]}
 */
export function getPinnedIds(event) {
  return getPinnedRefs(event)
    .filter((ref) => ref.type === 'e')
    .map((ref) => ref.value);
}

/** @param {{tags?: string[][]}} event @param {string} name */
function tagValue(event, name) {
  return event.tags?.find((t) => t[0] === name)?.[1];
}

/**
 * The current pin list of `groupId`, every entry: the newest list among the
 * relay's 39005s (bound by `d`) and the stored 9010s (bound by `h`). On a
 * tie the 39005 wins — the relay regenerated it FROM that 9010 with the same
 * stamp. An empty list is still a list: a 9010 with no entries clears the
 * pins.
 *
 * @param {{groupId: string, pinnedEvents: any[], updateEvents: any[]}} args
 * @returns {PinRef[]}
 */
export function resolvePinnedRefs({ groupId, pinnedEvents, updateEvents }) {
  /** @type {{event: any, relay: boolean} | null} */
  let best = null;
  const consider = (/** @type {any} */ event, /** @type {boolean} */ relay) => {
    if (!event) return;
    if (
      !best ||
      event.created_at > best.event.created_at ||
      (event.created_at === best.event.created_at && relay && !best.relay)
    ) {
      best = { event, relay };
    }
  };
  for (const event of pinnedEvents ?? []) {
    if (event?.kind === PINNED_EVENTS_KIND && tagValue(event, 'd') === groupId)
      consider(event, true);
  }
  for (const event of updateEvents ?? []) {
    if (event?.kind === UPDATE_PIN_LIST_KIND && tagValue(event, 'h') === groupId)
      consider(event, false);
  }
  return best ? getPinnedRefs(/** @type {{event: any}} */ (best).event) : [];
}

/**
 * The current pinned event ids of `groupId` — the `e` side of
 * {@link resolvePinnedRefs}.
 * @param {{groupId: string, pinnedEvents: any[], updateEvents: any[]}} args
 * @returns {string[]}
 */
export function resolvePinnedIds(args) {
  return resolvePinnedRefs(args)
    .filter((ref) => ref.type === 'e')
    .map((ref) => ref.value);
}
