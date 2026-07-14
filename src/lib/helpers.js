/**
 * Parse community content type definitions from a Nostr event's tags.
 *
 * The function scans event.tags for structured tag sequences that define one or
 * more "content types". Each content type begins with a "content" tag and may be
 * followed by related tags that modify the current content type until another
 * "content" tag starts a new one.
 *
 * Recognized tags (when inside a current content type):
 * - ["content", name]              -> starts a new content type with the given name
 * - ["k", kindString]              -> adds a numeric kind (parsed with parseInt) to the kinds array
 * - ["fee", amount, unit?]         -> sets fee.amount and fee.unit (unit defaults to "sat" if missing)
 * - ["exclusive", "true"|"false"]  -> sets exclusive flag (true only if tag[1] === "true")
 * - ["role", ...roleNames]         -> sets roles to the remaining values in the tag
 *
 * The last content type encountered is pushed to the result when iteration completes.
 *
 * @typedef {Object} CommunityContentType
 * @property {string} name - The name of the content type (from the "content" tag).
 * @property {number[]} kinds - Array of numeric kinds collected from "k" tags.
 * @property {{amount: string, unit: string}=} fee - Optional fee object from a "fee" tag.
 * @property {boolean=} exclusive - Optional flag from an "exclusive" tag (defaults to false).
 * @property {string[]=} roles - Optional array of role names from "role" tags.
 *
 * @param {Object} event - A Nostr event object.
 * @param {Array.<Array.<string>>} event.tags - The event's tags (array of string arrays).
 *
 * @returns {CommunityContentType[]} Array of parsed community content type objects.
 *
 * @example
 * // Example input:
 * // event.tags = [
 * //   ["content","post"],
 * //   ["k","1"],
 * //   ["fee","100","sat"],
 * //   ["role","member","contributor"],
 * //   ["content","announcement"],
 * //   ["k","100"],
 * //   ["exclusive","true"]
 * // ];
 * //
 * // Result:
 * // [
 * //   { name: "post", kinds: [1], fee: {amount: "100", unit: "sat"}, exclusive: false, roles: ["member","contributor"] },
 * //   { name: "announcement", kinds: [100], exclusive: true, roles: [] }
 * // ]
 */
export function getCommunityContentTypes(event) {
  /** @type {Array<{name: string, kinds: number[], exclusive: boolean, roles: string[], fee?: {amount: string, unit: string}}>} */
  const contentTypes = [];
  /** @type {{name: string, kinds: number[], exclusive: boolean, roles: string[], fee?: {amount: string, unit: string}} | null} */
  let currentContentType = null;

  if (!event || !Array.isArray(event.tags)) return contentTypes;

  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag.length === 0) continue;
    const key = tag[0];

    if (key === 'content') {
      if (currentContentType) contentTypes.push(currentContentType);
      currentContentType = {
        name: tag[1],
        kinds: [],
        exclusive: false,
        roles: []
      };
    } else if (key === 'k' && currentContentType) {
      const kind = parseInt(tag[1], 10);
      if (!Number.isNaN(kind)) currentContentType.kinds.push(kind);
    } else if (key === 'fee' && currentContentType) {
      currentContentType.fee = { amount: tag[1], unit: tag[2] || 'sat' };
    } else if (key === 'exclusive' && currentContentType) {
      currentContentType.exclusive = tag[1] === 'true';
    } else if (key === 'role' && currentContentType) {
      currentContentType.roles = tag.slice(1);
    }
  }

  if (currentContentType) contentTypes.push(currentContentType);
  return contentTypes;
}
