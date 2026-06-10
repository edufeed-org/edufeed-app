/**
 * Auto-self license attestation for user-uploaded blobs (avatars, banners).
 * Uploads to Blossom, then ensures a NIP-94 (kind 1063) license event exists:
 *   - If findExistingLicense returns one, reuse it.
 *   - Otherwise, publish a silent self-credit attestation
 *     (CC-BY-4.0, credit = displayName || pubkey.slice(0,8), p = pubkey).
 */
import { BlossomClient } from 'blossom-client-sdk';
import { getActiveBlossomServer } from '$lib/services/blossom-settings-service.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { findExistingLicense, buildLicenseTemplate } from '$lib/helpers/image-license.js';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';

/**
 * @typedef {Object} AutoSelfLicenseOptions
 * @property {{ pubkey: string, signEvent: (e: any) => Promise<any> }} signer
 * @property {string} displayName
 * @property {string} pubkey
 */

/**
 * @typedef {Object} AutoSelfLicenseResult
 * @property {string} url
 * @property {string} sha256
 * @property {number} size
 * @property {string} type
 * @property {any} licenseEvent
 */

/**
 * @param {File | Blob} file
 * @param {AutoSelfLicenseOptions} opts
 * @returns {Promise<AutoSelfLicenseResult>}
 */
export async function uploadWithAutoSelfLicense(file, opts) {
  const { signer, displayName, pubkey } = opts;

  const signerFn = async (/** @type {any} */ event) => signer.signEvent(event);
  const serverUrl = getActiveBlossomServer(pubkey, eventStore);
  const client = new BlossomClient(serverUrl, signerFn);
  const blob = await client.uploadBlob(file);

  const result = {
    url: blob.url,
    sha256: blob.sha256,
    size: blob.size ?? /** @type {any} */ (file).size ?? 0,
    type: blob.type || /** @type {any} */ (file).type || 'application/octet-stream',
    licenseEvent: /** @type {any} */ (null)
  };

  // Existing license? Reuse it.
  const existing = await findExistingLicense(blob.sha256);
  if (existing) {
    result.licenseEvent = existing;
    return result;
  }

  // Build + sign + publish self-credit attestation.
  const credit = (displayName && displayName.trim()) || pubkey.slice(0, 8);
  const template = buildLicenseTemplate({
    hash: blob.sha256,
    url: blob.url,
    mime: result.type,
    size: result.size,
    license: 'https://creativecommons.org/licenses/by/4.0/',
    credit,
    creatorPubkey: pubkey
  });

  const factory = createAppEventFactory();
  const eventTemplate = await factory.build(template);
  const signed = await signer.signEvent(eventTemplate);
  publishEventOptimistic(signed, [], {});

  result.licenseEvent = signed;
  return result;
}
