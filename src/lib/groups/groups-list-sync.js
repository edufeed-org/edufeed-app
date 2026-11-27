// Which entries the user's kind-10009 groups list lacks.
//
// The list is how other NIP-29 clients (Flotilla, Armada) find a person's
// groups: no entry, no space. Our own join writes one, but an admin's kind
// 9000, a join made in another client or one from before the app wrote the
// list leave the roster (./my-groups.svelte.js) ahead of the list. Pure; the
// Termi hint `groupsList` offers to add what this finds.
import { channelKey, flatChannelKey } from './community-pointer.js';
import { communityGroupsEndpoint } from './community-endpoint.js';
import { channelDeleted, channelHidden } from './channel-access.js';

/** @typedef {{id: string, relay: string}} Pointer */

/** @param {any} metadata @param {string} name */
const tagOf = (metadata, name) =>
  metadata?.tags?.find((/** @type {string[]} */ t) => t[0] === name);

/**
 * Roster memberships the list holds under neither of their two addresses.
 * @param {Pointer[]} listed the list's entries
 * @param {Pointer[]} memberships roster pointers (flat relay)
 * @returns {Pointer[]}
 */
export function unlistedMemberships(listed, memberships) {
  const have = new Set(listed.map(flatChannelKey));
  return memberships.filter((m) => {
    const key = flatChannelKey(m);
    return key !== null && !have.has(key);
  });
}

/**
 * The entries to add for them, each under the address the app writes
 * elsewhere: a community's root and channels at `wss://host/c/<rootId>`, a
 * standalone group at the flat host.
 *
 * Left out: a group whose kind 39000 has not arrived (nothing is known about
 * it), a deleted one, a breakout room or quick call (`ephemeral`), and a
 * `hidden` group — the list is public, and a hidden group is one its members
 * chose not to show.
 *
 * shortcut: a root is recognised by a channel of it in the roster or by a
 * `/c/<id>` address already in the list; a root the user holds no channel of
 * is listed at the flat host. Resolve it through the community's kind 10222
 * when that shows up as a missing space in another client.
 * @param {Pointer[]} listed
 * @param {Pointer[]} unlisted
 * @param {Record<string, any>} metadataByKey kind 39000 by channelKey
 * @returns {Pointer[]}
 */
export function groupsListAdditions(listed, unlisted, metadataByKey) {
  const known = unlisted
    .map((pointer) => ({ pointer, metadata: metadataByKey[channelKey(pointer) ?? ''] }))
    .filter(
      ({ metadata }) =>
        metadata &&
        !channelDeleted(metadata) &&
        !channelHidden(metadata) &&
        !tagOf(metadata, 'ephemeral')
    );

  const roots = new Set();
  for (const { relay } of listed) {
    const root = /\/c\/([^/]+)\/?$/.exec(relay)?.[1];
    if (root) roots.add(root);
  }
  for (const { metadata } of known) {
    const parent = tagOf(metadata, 'parent')?.[1];
    if (parent) roots.add(parent);
  }

  return known.map(({ pointer, metadata }) => {
    const root = tagOf(metadata, 'parent')?.[1] || (roots.has(pointer.id) ? pointer.id : null);
    return {
      id: pointer.id,
      relay: root ? communityGroupsEndpoint(pointer.relay, root) : pointer.relay
    };
  });
}
