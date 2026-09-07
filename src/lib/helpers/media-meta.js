/**
 * NIP-92 imeta lookup + display helpers for feed media rendering.
 */
import { getMediaAttachments } from 'applesauce-common/helpers';

/**
 * Build a normalized URL → imeta fields map for an event's media attachments.
 * Augmented with the NIP-94 `name` field (original filename) that
 * applesauce's FileMetadataFields doesn't carry — chat uploads (ours and
 * Armada's) write it so file cards can label the attachment.
 * @param {import('nostr-tools').Event} event
 * @returns {Map<string, import('applesauce-common/helpers').FileMetadataFields & {name?: string}>}
 */
export function getImetaByUrl(event) {
  const names = parseImetaNames(event.tags);
  /** @type {Map<string, any>} */
  const byUrl = new Map();
  for (const attachment of getMediaAttachments(event)) {
    if (!attachment.url) continue;
    try {
      const name = names.get(attachment.url);
      // Copy before augmenting — getMediaAttachments caches its result on the
      // event, and that shared object must not accumulate our extra fields.
      byUrl.set(new URL(attachment.url).toString(), name ? { ...attachment, name } : attachment);
    } catch {
      // ignore invalid URLs
    }
  }
  return byUrl;
}

/**
 * Raw-URL → `name` field of each imeta tag that carries one.
 * @param {string[][]} tags
 * @returns {Map<string, string>}
 */
function parseImetaNames(tags) {
  /** @type {Map<string, string>} */
  const names = new Map();
  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue;
    const url = tag.find((part) => part.startsWith('url '))?.slice(4);
    const name = tag.find((part) => part.startsWith('name '))?.slice(5);
    if (url && name) names.set(url, name);
  }
  return names;
}

/**
 * Display label for a file attachment: the original filename from imeta when
 * present, else the URL basename with a raw sha256 segment shortened.
 * @param {string} url
 * @param {{name?: string} | undefined} fields
 * @returns {string}
 */
export function attachmentDisplayName(url, fields) {
  if (fields?.name) return fields.name;
  try {
    const parsed = new URL(url);
    const basename = decodeURIComponent(parsed.pathname.split('/').pop() ?? '');
    if (!basename) return parsed.hostname;
    return basename.replace(/[0-9a-f]{64}/i, (hash) => `${hash.slice(0, 10)}…`);
  } catch {
    return url;
  }
}

/**
 * Format a byte count as "500 B" / "2.0 KB" / "5.0 MB".
 * @param {number | undefined} bytes
 * @returns {string | undefined}
 */
export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Parse imeta "WxH" dimensions into numbers.
 * @param {{ dimensions?: string } | undefined} fields
 * @returns {{ width: number, height: number } | undefined}
 */
export function parseImetaDimensions(fields) {
  const match = fields?.dimensions?.match(/^(\d+)x(\d+)$/);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return undefined;
  return { width, height };
}

/**
 * Format a duration in seconds as "m:ss" (or "h:mm:ss" from one hour up).
 * @param {number} seconds
 * @returns {string | undefined}
 */
export function formatMediaDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
