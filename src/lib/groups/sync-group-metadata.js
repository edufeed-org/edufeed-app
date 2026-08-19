// Task A7: re-issue a 9002 edit-metadata whenever the community's kind-0
// profile (name/about/picture) changes. A moderated community's linked
// NIP-29 root group carries those fields in its relay-generated 39000
// (that's what Armada shows) — but they were only ever copied ONCE, at
// flip-to-moderated time (provisionRootGroup), so they go stale on the next
// profile edit. Best-effort by design: the 10222/kind-0 save this runs after
// has already succeeded, so a relay refusal here must only ever surface as a
// warning at the call site, never block or unwind the save.
import {
  buildEditGroupMetadataTemplate,
  confirmGroupMetadata,
  publishToGroupRelay
} from './group-management.js';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';

/**
 * @param {{
 *   pointer: {id: string, relay: string},
 *   profile: {name?: string, about?: string, picture?: string},
 *   signerUser: {pubkey: string, signer: any}
 * }} args
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function syncRootGroupMetadata({ pointer, profile, signerUser }) {
  try {
    const relayConn = pool.relay(pointer.relay);
    const current = await confirmGroupMetadata(relayConn, pointer.id);
    const tags = current?.tags ?? [];
    // Mirror the group's CURRENT visibility off its own 39000 rather than
    // declaring it — this call only ever changes name/about/picture. Absence
    // of 'private'/'closed' means public/open (see buildEditGroupMetadataTemplate's
    // both-sides-explicit comment in group-management.js).
    const isPublic = !tags.some((/** @type {string[]} */ t) => t[0] === 'private');
    const isOpen = !tags.some((/** @type {string[]} */ t) => t[0] === 'closed');
    // The ROOT group has no parent, but mirror one through if somehow present
    // — same cheap-safety pattern GroupSettingsSheet uses for its own edits.
    const parent = tags.find((/** @type {string[]} */ t) => t[0] === 'parent')?.[1];

    const template = buildEditGroupMetadataTemplate(pointer.id, {
      name: profile?.name,
      about: profile?.about,
      picture: profile?.picture,
      isPublic,
      isOpen,
      ...(parent ? { parent } : {})
    });
    await publishToGroupRelay(relayConn, template, signerUser);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
