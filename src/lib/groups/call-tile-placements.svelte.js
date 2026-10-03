// The viewer's own tile order for the running call (Task 19): local, never
// broadcast. It lasts for the call — a channel switch, the dock or the
// pop-out keep it — and resets with the call: it is keyed by the LiveKit
// Room object, which is new on every join (a WeakMap, so a finished call's
// order goes away with its Room).

/** @type {Map<string, number>} */
const EMPTY = new Map();
/** @type {WeakMap<object, Map<string, number>>} */
const byRoom = new WeakMap();
// WeakMap is not reactive: bump this on every write so readers re-run.
let version = $state(0);

/**
 * @param {object | null | undefined} room the LiveKit Room of the call
 * @returns {Map<string, number>} seat key -> index the user placed it at
 */
export function getTilePlacements(room) {
  void version;
  return (room && byRoom.get(room)) || EMPTY;
}

/**
 * @param {object | null | undefined} room
 * @param {Map<string, number>} placements
 */
export function setTilePlacements(room, placements) {
  if (!room) return;
  byRoom.set(room, placements);
  version++;
}
