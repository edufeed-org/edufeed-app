// Shared NIP-92 imeta parser. This module parses attachment metadata from
// Nostr message tags, including Concord's 0xChat-compatible blob-encryption
// fields and the webxdc session property for interactive package sessions.
//
// Pure reimplementation of applesauce-concord `helpers/imeta.js` +
// applesauce-common `getFileMetadataFromImetaTag`, kept package-import-free on
// purpose: ChannelChat imports this, and the src/lib/concord convention keeps
// component-reachable modules free of top-level package imports. The parity is
// TESTED against the dist — concord-attachments.test.js asserts our output
// deep-equals `parseImeta`'s for the same tags, so drift from the pinned dist
// fails CI.

/**
 * @typedef {{algorithm: string, key: string, nonce: string}} AttachmentEncryption
 * @typedef {{url: string, type?: string, sha256?: string, originalSha256?: string,
 *            size?: number, dimensions?: string, blurhash?: string, alt?: string,
 *            thumbnail?: string, image?: string, summary?: string, magnet?: string,
 *            infohash?: string, fallback?: string[], name?: string,
 *            encryption?: AttachmentEncryption, webxdc?: string}} MediaAttachment
 */

/**
 * Lowercase-hex validator (even length; optional exact length) — mirrors the dist.
 * @param {string | undefined} s
 * @param {number} [len]
 */
function isHex(s, len) {
  if (!s) return false;
  if (len !== undefined && s.length !== len) return false;
  return s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s);
}

/**
 * Parse the Concord client-encryption fields from an imeta tag's `name value`
 * entries. Returns undefined unless algorithm is aes-gcm with a 64-char hex
 * key and even-length hex nonce — malformed encryption drops the encryption,
 * not the attachment (the file may still be fetchable as plaintext).
 * @param {Record<string, string>} entry
 * @returns {AttachmentEncryption | undefined}
 */
function parseEncryption(entry) {
  const algorithm = entry['encryption-algorithm'];
  const key = entry['decryption-key'];
  const nonce = entry['decryption-nonce'];
  if (!algorithm || algorithm.toLowerCase() !== 'aes-gcm') return undefined;
  if (!isHex(key, 64) || !isHex(nonce)) return undefined;
  return { algorithm: 'aes-gcm', key: key.toLowerCase(), nonce: nonce.toLowerCase() };
}

/**
 * Parse one imeta tag's space-separated `name value` parts into
 * FileMetadataFields — field-for-field the same mapping as applesauce-common's
 * `getFileMetadataFromImetaTag` (url/m/x/ox/size/dim/... -> named fields).
 * @param {string[]} tag
 * @returns {MediaAttachment | null}
 */
function parseImetaTag(tag) {
  /** @type {Record<string, string>} */
  const entry = {};
  /** @type {string[] | undefined} */
  let fallback;
  for (let i = 1; i < tag.length; i++) {
    const match = /^(.+?)\s(.+)$/.exec(tag[i]);
    if (!match) continue;
    const [, name, value] = match;
    if (name === 'fallback') fallback = fallback ? [...fallback, value] : [value];
    else entry[name] = value;
  }
  if (!entry.url) return null;

  /** @type {MediaAttachment} */
  const att = { url: entry.url, fallback };
  if (entry.size) att.size = parseInt(entry.size);
  if (entry.m) att.type = entry.m;
  if (entry.x) att.sha256 = entry.x;
  if (entry.ox) att.originalSha256 = entry.ox;
  if (entry.dim) att.dimensions = entry.dim;
  if (entry.magnet) att.magnet = entry.magnet;
  if (entry.i) att.infohash = entry.i;
  if (entry.thumb) att.thumbnail = entry.thumb;
  if (entry.image) att.image = entry.image;
  if (entry.summary) att.summary = entry.summary;
  if (entry.alt) att.alt = entry.alt;
  if (entry.name) att.name = entry.name;
  if (entry.blurhash) att.blurhash = entry.blurhash;
  if (entry.webxdc) att.webxdc = entry.webxdc;
  att.encryption = parseEncryption(entry);
  return att;
}

/**
 * All media attachments on a chat rumor, in tag order. Invalid imeta tags
 * (no url) are skipped. Safe on rumors without tags.
 * @param {{tags?: string[][], content?: string, [key: string]: any} | null | undefined} message
 * @returns {MediaAttachment[]}
 */
export function getMessageAttachments(message) {
  const tags = message?.tags;
  if (!Array.isArray(tags)) return [];
  const out = [];
  // Deduped by url — the render layer keys on it, and a rumor repeating an
  // imeta tag is untrusted input that must not crash the keyed {#each}.
  const seen = new Set();
  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue;
    const att = parseImetaTag(tag);
    if (att && !seen.has(att.url)) {
      seen.add(att.url);
      out.push(att);
    }
  }
  return out;
}

/**
 * Coarse render bucket for an attachment, by mime prefix.
 * @param {MediaAttachment | {type?: string}} att
 * @returns {'image'|'video'|'audio'|'file'}
 */
export function classifyAttachment(att) {
  const mime = att?.type ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * Remove bare attachment URLs from the message text so the bubble doesn't
 * show a dead ciphertext link above the rendered embed. Prose and
 * non-attachment URLs are untouched; leftover runs of whitespace collapse.
 * @param {string} content
 * @param {Array<{url?: string}>} attachments
 * @returns {string}
 */
export function stripAttachmentUrls(content, attachments) {
  if (!content) return '';
  let text = content;
  for (const att of attachments) {
    if (att?.url) text = text.split(att.url).join(' ');
  }
  return text
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Serialize one media attachment as a NIP-92 `imeta` tag (NIP-94 field
 * names). Only fields that are present are written; returns null when there
 * is no url or no second field (NIP-92: "MUST have a url, and at least one
 * other field").
 * @param {Partial<MediaAttachment> & { url?: string }} att
 * @returns {string[] | null}
 */
export function buildImetaTag(att) {
  if (!att?.url) return null;
  /** @type {string[]} */
  const fields = [`url ${att.url}`];
  if (att.type) fields.push(`m ${att.type}`);
  if (att.sha256) fields.push(`x ${att.sha256}`);
  if (att.size) fields.push(`size ${att.size}`);
  if (att.dimensions) fields.push(`dim ${att.dimensions}`);
  if (att.blurhash) fields.push(`blurhash ${att.blurhash}`);
  if (att.alt) fields.push(`alt ${att.alt}`);
  if (att.name) fields.push(`name ${att.name}`);
  if (fields.length < 2) return null;
  return ['imeta', ...fields];
}

/**
 * The `imeta` tags for a long-form body: one per media URL that is still
 * present in `content`. Tags of a previous version (`existingTags`) are
 * carried over as long as their URL is still referenced — an edit session
 * only knows about the images uploaded in that session — and a fresh
 * attachment for the same URL replaces the carried-over tag. Attachments
 * whose URL the author removed from the text get no tag (NIP-92: each
 * imeta SHOULD match a URL in the content).
 * @param {string} content
 * @param {Array<Partial<MediaAttachment> & { url?: string }>} attachments
 * @param {string[][]} [existingTags]
 * @returns {string[][]}
 */
export function collectImetaTags(content, attachments, existingTags = []) {
  const text = content || '';
  /** @type {Map<string, string[]>} */
  const byUrl = new Map();
  for (const tag of existingTags) {
    if (tag[0] !== 'imeta') continue;
    const url = parseImetaTag(tag)?.url;
    if (url && text.includes(url)) byUrl.set(url, tag);
  }
  for (const att of attachments || []) {
    if (!att?.url || !text.includes(att.url)) continue;
    const tag = buildImetaTag(att);
    if (tag) byUrl.set(att.url, tag);
  }
  return [...byUrl.values()];
}

/**
 * Pure URL -> attachment lookup over an event's imeta tags (no caching on
 * the event, so it is safe inside Svelte `$derived`). Keyed by the raw url
 * as written in the tag.
 * @param {string[][] | undefined | null} tags
 * @returns {Map<string, MediaAttachment>}
 */
export function imetaByUrl(tags) {
  /** @type {Map<string, MediaAttachment>} */
  const map = new Map();
  if (!Array.isArray(tags)) return map;
  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue;
    const att = parseImetaTag(tag);
    if (att && !map.has(att.url)) map.set(att.url, att);
  }
  return map;
}
