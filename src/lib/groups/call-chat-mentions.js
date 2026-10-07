// @mentions in the call chat. Pure.
//
// The call chat has no Nostr event to hang `p` tags on, and the people who
// can be mentioned are exactly the ones in the LiveKit room — so a mention
// is plain `@Name` text plus the payload's `mentions: [identity…]`
// (`"*"` = everyone, typed as `@alle`). The composer offers the room's
// participants, the receiver renders the names it is told about as chips
// and treats a message that names it as a stronger signal.

/** Everyone in the call, as a mention identity. */
export const EVERYONE = '*';
// What "@everyone" is typed as, across the app's locales: a German sender's
// "@alle" must still become a chip for an English receiver.
const EVERYONE_WORDS = ['alle', 'all', 'everyone'];

const LIMIT = 8;

/** @typedef {{ identity: string, name: string, pubkey: string | null }} CallParticipantRef */
/** @typedef {{ key: string, name: string, pubkey: string | null }} CallMentionCandidate */

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Candidates for an `@query`: "everyone" first (when the query is empty or
 * starts "alle"/"all"/the localized label), then the participants whose
 * name has a word starting with the query. Case-insensitive, at most 8.
 * @param {string} query text after the `@`
 * @param {CallParticipantRef[]} participants the OTHER people in the room
 * @param {{ everyone: string }} labels localized "alle"
 * @returns {CallMentionCandidate[]}
 */
export function mentionCandidates(query, participants, { everyone }) {
  const q = query.trim().toLowerCase();
  /** @type {CallMentionCandidate[]} */
  const out = [];
  const everyoneWords = [everyone, ...EVERYONE_WORDS].map((w) => w.toLowerCase());
  if (!q || everyoneWords.some((w) => w.startsWith(q))) {
    out.push({ key: EVERYONE, name: everyone, pubkey: null });
  }
  for (const p of participants) {
    if (out.length >= LIMIT) break;
    const name = p.name.toLowerCase();
    if (!q || name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q))) {
      out.push({ key: p.identity, name: p.name, pubkey: p.pubkey });
    }
  }
  return out.slice(0, LIMIT);
}

/**
 * The identities a draft still mentions: every picked `@Name` that is
 * still in the text (so a name typed over or deleted is not sent along),
 * once each, in order of first appearance.
 * @param {string} text
 * @param {Record<string, string>} picked name → identity (or EVERYONE)
 * @returns {string[]}
 */
export function mentionsIn(text, picked) {
  /** @type {Array<{ at: number, identity: string }>} */
  const hits = [];
  for (const [name, identity] of Object.entries(picked)) {
    const re = new RegExp(`(?<![\\w@])@${escapeRe(name)}(?![\\w])`, 'g');
    const m = re.exec(text);
    if (m) hits.push({ at: m.index, identity });
  }
  hits.sort((a, b) => a.at - b.at);
  return [...new Set(hits.map((h) => h.identity))];
}

/**
 * Split `@Name` of the mentioned identities out of the text segments as
 * chips; everything else is left as it is. Longer names first, so
 * "@Anna Lund" is not eaten by "@Anna". Returns the input array when there
 * is nothing to do.
 * @template {{ text: string } | object} S
 * @param {S[]} segments
 * @param {string[] | undefined} mentions identities the message declares
 * @param {Record<string, string>} names identity → display name (EVERYONE → "alle")
 * @returns {Array<S | { mention: string, label: string }>}
 */
export function withMentions(segments, mentions, names) {
  if (!mentions?.length) return segments;
  const labelled = mentions
    .flatMap((identity) =>
      identity === EVERYONE
        ? [...new Set([names[identity], ...EVERYONE_WORDS])].map((name) => ({ identity, name }))
        : [{ identity, name: names[identity] }]
    )
    .filter((m) => typeof m.name === 'string' && m.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  if (labelled.length === 0) return segments;
  const byName = new Map(labelled.map((m) => [m.name, m.identity]));
  const re = new RegExp(
    `(?<![\\w@])@(${labelled.map((m) => escapeRe(m.name)).join('|')})(?![\\w])`,
    'g'
  );
  /** @type {Array<S | { mention: string, label: string }>} */
  const out = [];
  for (const seg of segments) {
    if (!('text' in seg) || typeof seg.text !== 'string') {
      out.push(seg);
      continue;
    }
    let last = 0;
    for (const match of seg.text.matchAll(re)) {
      const at = /** @type {number} */ (match.index);
      if (at > last) out.push(/** @type {S} */ ({ text: seg.text.slice(last, at) }));
      out.push({ mention: /** @type {string} */ (byName.get(match[1])), label: match[0] });
      last = at + match[0].length;
    }
    if (last < seg.text.length) out.push(/** @type {S} */ ({ text: seg.text.slice(last) }));
  }
  return out;
}

/**
 * Whether a message from someone else names me (or everyone).
 * @param {{ identity: string, mentions?: string[] }} msg
 * @param {string | null | undefined} myIdentity
 */
export function isMentioned(msg, myIdentity) {
  if (!myIdentity || !msg.mentions?.length || msg.identity === myIdentity) return false;
  return msg.mentions.includes(myIdentity) || msg.mentions.includes(EVERYONE);
}
