// One-line preview of a DM for the conversation list. A kind-15 rumor's
// content is the encrypted blob's URL, which must never be shown as text.
import { isDmFileRumor, parseFileRumor, rumorContent } from '$lib/helpers/dm-rumors.js';

/**
 * @param {any} rumor
 * @param {{ image: () => string, file: () => string }} labels
 * @returns {string}
 */
export function dmPreviewText(rumor, labels) {
  if (!rumor) return '';
  // rumorContent, not rumor.content: an unsigned rumor's content can be a
  // number or an object, and this string lands in the navbar's inbox item —
  // rendered outside the route-level <svelte:boundary>.
  if (!isDmFileRumor(rumor)) return rumorContent(rumor);
  const file = parseFileRumor(rumor);
  return file?.mimeType?.startsWith('image/') ? labels.image() : labels.file();
}
