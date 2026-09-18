// One-line preview of a DM for the conversation list. A kind-15 rumor's
// content is the encrypted blob's URL, which must never be shown as text.
import { isDmFileRumor, parseFileRumor } from '$lib/helpers/dm-rumors.js';

/**
 * @param {any} rumor
 * @param {{ image: () => string, file: () => string }} labels
 * @returns {string}
 */
export function dmPreviewText(rumor, labels) {
  if (!rumor) return '';
  if (!isDmFileRumor(rumor)) return rumor.content ?? '';
  const file = parseFileRumor(rumor);
  return file?.mimeType?.startsWith('image/') ? labels.image() : labels.file();
}
