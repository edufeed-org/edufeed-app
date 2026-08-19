/**
 * Helpers for interactive (webxdc) AMB resources: locating the package
 * encoding, deriving the stable per-app key, and cleaning up the companion
 * kind-1063 discovery/license event on delete.
 */
import { findExistingLicense } from '$lib/helpers/image-license.js';
import { deleteEvent } from '$lib/helpers/eventDeletion.js';

/**
 * @typedef {{url?: string, mimeType?: string, sha256?: string, name?: string}} ResourceEncoding
 */

/**
 * @param {{encodings?: ResourceEncoding[]} | null} resource
 * @returns {ResourceEncoding | null}
 */
export function findInteractiveEncoding(resource) {
  return resource?.encodings?.find((e) => e.mimeType === 'application/x-webxdc') ?? null;
}

/**
 * Stable addressable key for sandbox subdomain + local state storage.
 * @param {{kind: number, pubkey: string, tags?: string[][]}} event
 * @returns {string}
 */
export function resourceAppKey(event) {
  const dTag = event.tags?.find((t) => t[0] === 'd')?.[1] || '';
  return `${event.kind}:${event.pubkey}:${dTag}`;
}

/**
 * Delete the user's own kind-1063 for the package hash (NIP-DC discovery +
 * license attestation). Best-effort: a failure must never block the main
 * resource deletion, so errors are swallowed.
 * @param {string} sha256
 * @param {{ pubkey: string, signEvent: Function }} activeUser
 */
export async function deleteCompanionLicense(sha256, activeUser) {
  try {
    const license = await findExistingLicense(sha256);
    if (license && license.pubkey === activeUser.pubkey) {
      await deleteEvent(license, activeUser);
    }
  } catch (err) {
    console.warn('Companion 1063 deletion skipped:', err);
  }
}
