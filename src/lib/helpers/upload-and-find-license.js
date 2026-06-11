/**
 * Upload a blob to Blossom and look up any existing kind 1063 license event
 * for its SHA-256 hash. Does NOT publish a license event — the LicenseModal
 * component owns that responsibility (requires user consent).
 */
import { BlossomClient } from 'blossom-client-sdk';
import { getActiveBlossomServer } from '$lib/services/blossom-settings-service.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { findExistingLicense } from '$lib/helpers/image-license.js';
import { reconcileBlobUrlScheme } from '$lib/helpers/blossom-trust.js';

/**
 * @typedef {Object} UploadAndFindOptions
 * @property {{ pubkey: string, signEvent: (e: any) => Promise<any> }} signer
 */

/**
 * @typedef {Object} UploadAndFindResult
 * @property {string} url
 * @property {string} sha256
 * @property {number} size
 * @property {string} type
 * @property {any} existingLicense   // null when no existing license is found
 */

/**
 * @param {File | Blob} file
 * @param {UploadAndFindOptions} opts
 * @returns {Promise<UploadAndFindResult>}
 */
export async function uploadAndFindLicense(file, opts) {
  const { signer } = opts;

  const signerFn = async (/** @type {any} */ event) => signer.signEvent(event);
  const serverUrl = getActiveBlossomServer(signer.pubkey, eventStore);
  const client = new BlossomClient(serverUrl, signerFn);
  const blob = await client.uploadBlob(file);

  const existing = await findExistingLicense(blob.sha256);

  return {
    url: reconcileBlobUrlScheme(blob.url, serverUrl),
    sha256: blob.sha256,
    size: blob.size ?? /** @type {any} */ (file).size ?? 0,
    type: blob.type || /** @type {any} */ (file).type || 'application/octet-stream',
    existingLicense: existing ?? null
  };
}
