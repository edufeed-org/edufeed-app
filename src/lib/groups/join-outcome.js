/**
 * What a sent join request (kind 9021) amounted to, for the toast: the
 * refreshed roster decides ("joined" when I am on it, "request sent" when a
 * readable roster still lacks me); only when the roster cannot be read
 * (restricted / never answered) does the NIP-29 `closed` marker decide —
 * an open group admits on the accepted 9021, a closed one queues it.
 *
 * @param {{onRoster: boolean, rosterReadable: boolean, closed: boolean}} p
 * @returns {'joined' | 'sent'}
 */
export function joinOutcome({ onRoster, rosterReadable, closed }) {
  if (onRoster) return 'joined';
  if (rosterReadable) return 'sent';
  return closed ? 'sent' : 'joined';
}
