import { normalizeIdentifier } from 'nostr-tools/nip54';

/**
 * Pre-processes markdown content to convert NIP-54 wikilinks into markdown links.
 * `[[target]]` becomes `[target](/wiki/normalized-target)`.
 * `[[target|label]]` becomes `[label](/wiki/normalized-target)`.
 *
 * @param {string | null | undefined} text - Raw markdown content
 * @returns {string} Content with wikilinks converted to markdown links
 */
export function preprocessWikilinks(text) {
  if (!text) return '';
  return text.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, label) => {
    const normalized = normalizeIdentifier(target.trim());
    return `[${(label || target).trim()}](/wiki/${encodeURIComponent(normalized)})`;
  });
}

/**
 * Pre-processes markdown content to convert bare `nostr:` mentions into markdown links.
 * Bare mentions like `nostr:npub1abc...xyz` become `[npub1abc…wxyz](/npub1abc...xyz)`.
 * Existing markdown links like `[text](nostr:naddr1...)` are left alone (handled by marked renderer).
 *
 * @param {string} text - Raw markdown content
 * @returns {string} Content with bare nostr mentions converted to markdown links
 */
export function preprocessNostrMentions(text) {
  if (!text) return '';
  return text.replace(
    /(?<!\()\bnostr:((?:npub|nprofile|naddr|note|nevent)1[a-z0-9]+)/gi,
    (_, id) => {
      const display = id.length > 14 ? `${id.slice(0, 10)}\u2026${id.slice(-3)}` : id;
      return `[${display}](/${id})`;
    }
  );
}
