// The paste path's "is that really the group you mean?" card: fetch the
// group's own 39000 from the host and shape it for display. No blind attach.
import { confirmGroupMetadata } from './group-management.js';
import { channelAccessLevel } from './channel-access.js';
import { authenticateOnce, isAuthRequiredError } from './relay-auth.js';

/**
 * @param {{kind?: number, tags?: string[][]} | null | undefined} metadata
 * @returns {{name: string, picture: string | null, worldReadable: boolean} | null}
 */
export function groupPreviewFromMetadata(metadata) {
  if (!metadata || metadata.kind !== 39000 || !Array.isArray(metadata.tags)) return null;
  const tag = (/** @type {string} */ name) =>
    metadata.tags?.find((t) => t[0] === name && t[1]?.trim())?.[1]?.trim() ?? null;
  return {
    name: tag('name') ?? tag('d') ?? '',
    picture: tag('picture'),
    worldReadable: channelAccessLevel(metadata, undefined) === 'world'
  };
}

/**
 * An auth-walled host answers the preview request with `auth-required` until
 * we AUTH — the existing retry pattern from relay-directory.svelte.js
 * (isAuthRequiredError + authenticateOnce), inlined here since this is a
 * one-shot request rather than a persisted subscription. Never rejects: a
 * refused/failed auth just means "no preview", same as any other miss.
 *
 * @param {any} relayConn a pool.relay(url) connection
 * @param {{id: string, relay: string}} pointer
 * @param {any} [signer] the active user's signer, used only on an
 *   auth-required failure — no signer means no retry, not an error.
 */
export async function fetchGroupPreview(relayConn, pointer, signer) {
  try {
    const metadata = await confirmGroupMetadata(relayConn, pointer.id);
    return groupPreviewFromMetadata(metadata);
  } catch (err) {
    if (!isAuthRequiredError(err) || !signer) return null;
    const response = await authenticateOnce(relayConn, signer);
    if (!response.ok) return null;
    try {
      const metadata = await confirmGroupMetadata(relayConn, pointer.id);
      return groupPreviewFromMetadata(metadata);
    } catch {
      return null;
    }
  }
}
