// The paste path's "is that really the group you mean?" card: fetch the
// group's own 39000 from the host and shape it for display. No blind attach.
import { confirmGroupMetadata } from './group-management.js';
import { channelAccessLevel } from './channel-access.js';

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
 * @param {any} relayConn a pool.relay(url) connection
 * @param {{id: string, relay: string}} pointer
 */
export async function fetchGroupPreview(relayConn, pointer) {
  try {
    const metadata = await confirmGroupMetadata(relayConn, pointer.id);
    return groupPreviewFromMetadata(metadata);
  } catch {
    return null;
  }
}
