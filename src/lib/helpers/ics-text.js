/**
 * Pure RFC 5545 (iCalendar) text helpers shared by every ICS writer in this
 * app — the scheduled-meeting export (`$lib/groups/meetings.js`) and the
 * calendar feed export (`$lib/server/calendar-ics.js`) — so escaping,
 * folding and UID sanitisation stay identical wherever a NIP-52 event is
 * turned into an .ics file. No other imports: safe from a plain module, a
 * Svelte component, or a SvelteKit server route alike.
 */

/**
 * RFC 5545 TEXT escaping. CRLF counts as one newline; any other CR is dropped,
 * since a raw CR in the output would end the content line.
 *
 * @param {string | number} text
 * @returns {string}
 */
export function escapeIcsText(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * A stable UID for a calendar coordinate (or caller-given value), made safe
 * for the UID content line: trimmed, internal whitespace/newlines collapsed,
 * non-printable-ASCII characters dropped (a coordinate is plain
 * `kind:pubkey:d` so this never touches real content).
 *
 * @param {string | undefined} value
 * @returns {string} `''` when `value` is missing/empty
 */
export function sanitizeIcsUid(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\x21-\x7e]/g, '');
}

/** RFC 5545 §3.1: content lines SHOULD NOT exceed this many octets. */
export const ICS_MAX_LINE_OCTETS = 75;

/**
 * RFC 5545 line folding: a content line longer than 75 octets (UTF-8 bytes,
 * excluding the line break) is split with CRLF + a single leading space on
 * each continuation line. Splits only on UTF-8 character boundaries — never
 * mid multi-byte sequence — by backing off the chunk boundary past any
 * continuation bytes (`10xxxxxx`).
 *
 * @param {string} line
 * @returns {string}
 */
export function foldIcsLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= ICS_MAX_LINE_OCTETS) return line;

  const decoder = new TextDecoder('utf-8');
  const chunks = [];
  let start = 0;
  // The first line may use the full 75 octets; continuation lines reserve
  // one octet for their mandatory leading space.
  let limit = ICS_MAX_LINE_OCTETS;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }
    chunks.push(decoder.decode(bytes.slice(start, end)));
    start = end;
    limit = ICS_MAX_LINE_OCTETS - 1;
  }
  return chunks.join('\r\n ');
}
