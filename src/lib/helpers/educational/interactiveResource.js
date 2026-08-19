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
 * @typedef {{ url: string, name: string, type: string, size: number,
 *   sha256: string, licenseEvent: import('nostr-tools').NostrEvent | null,
 *   iconUrl?: string }} InteractivePackage
 */

/**
 * @typedef {{url?: string, name?: string, type?: string, size?: number,
 *   sha256?: string, licenseEvent?: import('nostr-tools').NostrEvent | null}} UploadedFileWithLicense
 */

/**
 * Rehydrate the wizard's `interactivePackage` step-2 state from an already
 * restored `formData.encodings` (the wizard's own `type`-keyed
 * UploadedFileWithLicense shape — draft persistence and the mapping $effect
 * both use it, unlike edit mode's mimeType-keyed AMB encodings). Used to
 * seed the field back from a restored draft, which only persists
 * `formData` and has no local package bytes to rebuild it from otherwise.
 * @param {UploadedFileWithLicense[] | null | undefined} encodings
 * @returns {InteractivePackage | null}
 */
export function seedInteractivePackageFromEncodings(encodings) {
  const pkg = encodings?.find((e) => e.type === 'application/x-webxdc');
  if (!pkg) return null;
  return {
    url: pkg.url ?? '',
    name: pkg.name ?? '',
    type: 'application/x-webxdc',
    size: pkg.size ?? 0,
    sha256: pkg.sha256 ?? '',
    licenseEvent: pkg.licenseEvent ?? null,
    iconUrl: ''
  };
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
