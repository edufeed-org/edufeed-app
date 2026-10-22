/**
 * Removing one of the user's own uploads ("Meine Uploads" on the profile):
 *
 *   1. Blossom `DELETE /<sha256>` on every server that hosts the blob, with a
 *      BUD-01 kind-24242 delete auth (`t=delete`, `x=<hash>`) signed by the
 *      uploader. One auth covers all servers — it names the hash, not the
 *      host. A 404 means the blob is already gone and counts as success; any
 *      other failure is reported per server but does not stop the rest.
 *   2. NIP-09 on the kind-1063 attestation (`deleteEvent`), so the license
 *      badge disappears and the image stops being discoverable — that part
 *      must succeed for the removal to count.
 */
import { BlossomClient } from 'blossom-client-sdk';
import { deleteEvent } from '$lib/helpers/eventDeletion.js';
import { getLicenseHash } from '$lib/helpers/my-uploads.js';

/**
 * @typedef {{ server: string, status: 'deleted' | 'missing' | 'failed' }} BlossomDeleteResult
 */

/**
 * @param {import('nostr-tools').NostrEvent} licenseEvent - the kind 1063 to remove
 * @param {{ pubkey: string, signer: { signEvent: (t: any) => Promise<any> } } | null | undefined} activeUser
 * @param {{ servers: string[] }} opts - Blossom servers to delete the blob from (see blossomServersForLicense)
 * @returns {Promise<{ success: boolean, blossom: BlossomDeleteResult[], error?: string }>}
 */
export async function removeUpload(licenseEvent, activeUser, opts) {
  if (!activeUser?.signer || !licenseEvent) {
    return { success: false, blossom: [], error: 'Missing required parameters' };
  }
  if (licenseEvent.pubkey !== activeUser.pubkey) {
    return { success: false, blossom: [], error: 'You can only remove your own uploads' };
  }
  const hash = getLicenseHash(licenseEvent);
  if (!hash) {
    return { success: false, blossom: [], error: 'Attestation carries no blob hash' };
  }

  /** @type {BlossomDeleteResult[]} */
  const blossom = [];
  const servers = opts?.servers || [];
  if (servers.length > 0) {
    const signer = async (/** @type {any} */ template) => activeUser.signer.signEvent(template);
    const auth = await BlossomClient.createDeleteAuth(signer, hash);
    for (const server of servers) {
      try {
        await BlossomClient.deleteBlob(server, hash, { auth });
        blossom.push({ server, status: 'deleted' });
      } catch (err) {
        const status = /** @type {any} */ (err)?.status;
        blossom.push({ server, status: status === 404 ? 'missing' : 'failed' });
        if (status !== 404) console.warn('removeUpload: Blossom delete failed on', server, err);
      }
    }
  }

  const result = await deleteEvent(licenseEvent, activeUser);
  if (!result.success) return { success: false, blossom, error: result.error };
  return { success: true, blossom };
}
