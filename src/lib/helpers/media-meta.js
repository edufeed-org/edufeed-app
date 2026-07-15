/**
 * NIP-92 imeta lookup + display helpers for feed media rendering.
 */
import { getMediaAttachments } from 'applesauce-common/helpers';

/**
 * Build a normalized URL → imeta fields map for an event's media attachments.
 * @param {import('nostr-tools').Event} event
 * @returns {Map<string, import('applesauce-common/helpers').FileMetadataFields>}
 */
export function getImetaByUrl(event) {
  /** @type {Map<string, any>} */
  const byUrl = new Map();
  for (const attachment of getMediaAttachments(event)) {
    if (!attachment.url) continue;
    try {
      byUrl.set(new URL(attachment.url).toString(), attachment);
    } catch {
      // ignore invalid URLs
    }
  }
  return byUrl;
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
