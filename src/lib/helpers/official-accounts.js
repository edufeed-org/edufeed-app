/**
 * Which accounts speak for the platform.
 *
 * System messages — the NIP-05 welcome DM above all — go out from a real
 * admin's own account, not from a dedicated "edufeed" identity (that would
 * need a server-held key and server-side NIP-17). Read in another client the
 * sender is just whoever approved the application, so the DM text introduces
 * itself; read in this app, the surfaces that show DM senders badge these
 * accounts so the message is recognisable as official rather than as a bot
 * or a stranger.
 *
 * The list is the membership admins from config (`MEMBERSHIP_ADMIN_PUBKEYS`):
 * they are exactly the accounts that send these DMs, and the deployment
 * already vouches for them. Reuse it rather than adding a parallel allowlist.
 */
import { runtimeConfig } from '$lib/stores/config.svelte.js';

/** @returns {string[]} hex pubkeys */
export function getOfficialPubkeys() {
  return runtimeConfig.membership?.adminPubkeys || [];
}

/**
 * @param {string | undefined | null} pubkey - hex pubkey
 * @returns {boolean}
 */
export function isOfficialPubkey(pubkey) {
  return !!pubkey && getOfficialPubkeys().includes(pubkey);
}
