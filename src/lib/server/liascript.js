/**
 * An article (kind 30023/30024) as a LiaScript course: plain CommonMark is
 * already valid LiaScript, it only needs the header comment.
 */
import { nip19 } from 'nostr-tools';

/** @param {string[][] | undefined} tags @param {string} name */
const tag = (tags, name) => tags?.find((t) => t[0] === name)?.[1];

/** One line, and never `-->` (it would close the header comment). @param {string} s */
const line = (s) => s.replace(/\s+/g, ' ').replace(/--+>?/g, '-').trim();

/**
 * @param {{ pubkey: string, tags?: string[][], content?: string }} event
 * @returns {string}
 */
export function liascriptMarkdown(event) {
  const npub = nip19.npubEncode(event.pubkey);
  const lang =
    [tag(event.tags, 'language'), tag(event.tags, 'l')].find((l) =>
      /^[a-z]{2}(-[A-Za-z]{2})?$/.test(l ?? '')
    ) ?? 'de';
  const comment = line(tag(event.tags, 'summary') ?? '').slice(0, 200);
  const header = [
    '<!--',
    `author: ${npub.slice(0, 9)}…${npub.slice(-4)}`,
    'version: 1.0.0',
    `language: ${lang}`,
    `narrator: ${lang.startsWith('de') ? 'Deutsch Female' : 'US English Female'}`,
    ...(comment ? [`comment: ${comment}`] : []),
    '-->'
  ].join('\n');
  const content = (event.content ?? '').trim();
  const title = (tag(event.tags, 'title') ?? '').replace(/\s+/g, ' ').trim();
  const heading = title && !/^#\s/.test(content) ? `# ${title}\n\n` : '';
  return `${header}\n\n${heading}${content}`;
}

/**
 * The deployment block list (`BLOCKED_PUBKEYS`): hex and npub entries.
 * shortcut: entries naming a kind 30000 list (naddr) are not resolved server-side — resolve them here if a listed author ever shows up.
 * @param {string} pubkey @param {string | undefined} csv
 */
export function isBlockedPubkey(pubkey, csv) {
  return (csv ?? '').split(',').some((entry) => {
    const s = entry.trim();
    if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase() === pubkey;
    try {
      const d = nip19.decode(s);
      return d.type === 'npub' && d.data === pubkey;
    } catch {
      return false;
    }
  });
}
