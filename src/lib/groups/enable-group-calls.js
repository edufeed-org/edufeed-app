// Admin one-click "Start call" in a channel that is not an AV space yet.
//
// A NIP-29 9002 REPLACES the group's metadata: whatever it leaves out is
// gone (name, private/closed, hidden, the subgroup parent — and livekit
// itself, which is why every other 9002 restates it). So this reads the
// relay's current 39000 and restates every field, only switching the bare
// `livekit` tag on. Nothing is sent when the current state is unknown.
import {
  buildEditGroupMetadataTemplate,
  confirmGroupMetadata,
  publishToGroupRelay
} from './group-management.js';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';

/**
 * @param {{id: string, relay: string}} pointer
 * @param {{pubkey: string, signer: any}} user
 */
export async function enableGroupCalls(pointer, user) {
  const relayConn = pool.relay(pointer.relay);
  const current = await confirmGroupMetadata(relayConn, pointer.id);
  if (!current) throw new Error('group metadata not available');
  /** @type {string[][]} */
  const tags = current.tags ?? [];
  /** @param {string} name */
  const has = (name) => tags.some((t) => t[0] === name);
  /** @param {string} name */
  const value = (name) => tags.find((t) => t[0] === name)?.[1];

  const parent = value('parent');
  const template = buildEditGroupMetadataTemplate(pointer.id, {
    name: value('name'),
    about: value('about'),
    picture: value('picture'),
    isPublic: !has('private'),
    isOpen: !has('closed'),
    isHidden: has('hidden'),
    livekit: true,
    ...(parent ? { parent } : {})
  });
  await publishToGroupRelay(relayConn, template, user);
}
