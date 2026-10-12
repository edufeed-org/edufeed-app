/**
 * Media device list helpers for the call device pickers.
 *
 * `enumerateDevices()` (what `Room.getLocalDevices` wraps) is not guaranteed
 * to return unique `deviceId`s: Firefox lists every device of a kind with
 * `deviceId: ""` until a capture permission has been granted, and some
 * audiooutput setups repeat an id. The pickers key their {#each} blocks by
 * `deviceId`, and a duplicate key throws `each_key_duplicate` — which kills
 * the whole call route. Run every enumerated list through `dedupeDevices`
 * before it is stored.
 *
 * Kept dependency-free so it is safe to import anywhere (node tests, jsdom).
 */

/**
 * Keep the first entry per `deviceId`, preserving order. Entries with an
 * empty (or missing) `deviceId` are kept at most once — the first one — so
 * a pre-permission placeholder still renders; its `deviceId` stays exactly
 * what the browser handed out, because that is what a `<select>` value or a
 * `switchActiveDevice` call must pass back. Always returns a fresh array.
 *
 * @param {MediaDeviceInfo[] | null | undefined} devices
 * @returns {MediaDeviceInfo[]}
 */
export function dedupeDevices(devices) {
  if (!devices) return [];
  const seen = new Set();
  const out = [];
  for (const device of devices) {
    const id = device?.deviceId || '';
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(device);
  }
  return out;
}
