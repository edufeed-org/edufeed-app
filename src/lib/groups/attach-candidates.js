// Which existing groups can become a channel of THIS community, and what the
// attach flow needs to know about each. Pure — the reactive plumbing stays in
// AreaAttachModal.svelte.
import { linkedChannelKeys, groupCandidateEntries } from './unlinked-groups.js';
import { parseGroupInput } from './groups.js';

/**
 * The user's NIP-29 groups that are not yet a channel of THIS community.
 * Exclusion compares by channelKey, so slash spellings cannot sneak a linked
 * group back in. Missing metadata counts as closed — the safe reading, and
 * the one that keeps the access question on screen.
 * @param {{
 *   groups?: Array<{id: string, relay: string}> | null,
 *   communikeyEvent?: any,
 *   metadataByKey?: Record<string, {kind?: number, tags?: string[][]}>
 * }} input
 * @returns {Array<{key: string, name: string, category: 'closed'|'world', worldReadable: boolean, pointer: {id: string, relay: string}}>}
 */
export function groupAttachCandidates({ groups, communikeyEvent, metadataByKey = {} }) {
  const linked = linkedChannelKeys(communikeyEvent ? [communikeyEvent] : []);
  return groupCandidateEntries({ groups, excludeKeys: linked, metadataByKey }).map((entry) => {
    const world = entry.level === 'world';
    return {
      key: entry.key,
      name: entry.name,
      category: /** @type {'closed'|'world'} */ (world ? 'world' : 'closed'),
      worldReadable: world,
      pointer: entry.pointer
    };
  });
}

/**
 * parseGroupInput, but forgiving about the scheme: people paste what their
 * browser or other app gave them, and that is https more often than wss.
 * @param {string} input
 * @returns {{relay: string, id: string} | null}
 */
export function parseGroupAddress(input) {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return null;

  // Only accept schemes we recognize: wss, http, https (and bare host'id with no scheme).
  // Reject ftp, gopher, etc.
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (!['wss', 'ws', 'http', 'https'].includes(scheme)) {
      return null;
    }
  }

  const mapped = trimmed.replace(/^(https?|ws):\/\//i, 'wss://');
  return parseGroupInput(mapped);
}

/**
 * Only a private NIP-29 target needs the access question: Concord manages its
 * own membership, and a world-readable group has nothing to gate.
 * @param {{kind: 'concord'|'group', worldReadable: boolean}} target
 */
export function attachAccessQuestion({ kind, worldReadable }) {
  return kind === 'group' && !worldReadable;
}
