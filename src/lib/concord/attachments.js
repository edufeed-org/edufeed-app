// Chat-message attachments: parse NIP-92 `imeta` tags (plus Concord's
// 0xChat-compatible blob-encryption fields) off a kind-9 rumor.
//
// Pure reimplementation of applesauce-concord `helpers/imeta.js` +
// applesauce-common `getFileMetadataFromImetaTag`, kept package-import-free on
// purpose: this module is statically imported by ChannelChat.svelte, and the
// src/lib/concord convention keeps component-reachable modules free of
// top-level package imports (see bridge.svelte.js). The parity is TESTED, not
// assumed — concord-attachments.test.js asserts our output deep-equals
// `parseImeta`'s for the same tags, so drift from the pinned dist fails CI.

/**
 * @typedef {{algorithm: 'aes-gcm', key: string, nonce: string}} AttachmentEncryption
 * @typedef {{url: string, type?: string, sha256?: string, originalSha256?: string,
 *            size?: number, dimensions?: string, blurhash?: string, alt?: string,
 *            thumbnail?: string, image?: string, summary?: string, magnet?: string,
 *            infohash?: string, fallback?: string[],
 *            encryption?: AttachmentEncryption}} MediaAttachment
 */

/** Lowercase-hex validator (even length; optional exact length) — mirrors the dist. */
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
  if (entry.blurhash) att.blurhash = entry.blurhash;
  att.encryption = parseEncryption(entry);
  return att;
}

/**
 * All media attachments on a chat rumor, in tag order. Invalid imeta tags
 * (no url) are skipped. Safe on rumors without tags.
 * @param {{tags?: string[][]} | null | undefined} message
 * @returns {MediaAttachment[]}
 */
export function getMessageAttachments(message) {
  const tags = message?.tags;
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue;
    const att = parseImetaTag(tag);
    if (att) out.push(att);
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
