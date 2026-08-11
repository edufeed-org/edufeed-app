// NIP-29 group-management templates (kinds 9000-9008). Pure builders in the
// lane's house style (see groups.js); tag shapes mirror applesauce-common's
// operations/group.js so events are wire-identical to factory output. The one
// deliberate difference: edit-metadata emits BOTH marker sides explicitly
// (public|private, open|closed) so flipping a flag always overwrites state.
import {
  PUT_USER_KIND,
  REMOVE_USER_KIND,
  EDIT_METADATA_KIND,
  CREATE_GROUP_KIND,
  DELETE_GROUP_KIND
} from 'applesauce-common/helpers/groups';

const now = () => Math.floor(Date.now() / 1000);
/** @param {number} kind @param {string[][]} tags */
const template = (kind, tags) => ({ kind, content: '', created_at: now(), tags });

/** @param {string} groupId */
export function buildCreateGroupTemplate(groupId) {
  return template(CREATE_GROUP_KIND, [['h', groupId]]);
}

/**
 * @param {string} groupId
 * @param {{name?: string, about?: string, picture?: string, isPublic: boolean, isOpen: boolean}} meta
 */
export function buildEditGroupMetadataTemplate(groupId, meta) {
  /** @type {string[][]} */
  const tags = [['h', groupId]];
  for (const key of /** @type {const} */ (['name', 'about', 'picture'])) {
    const value = meta[key]?.trim();
    if (value) tags.push([key, value]);
  }
  tags.push([meta.isPublic ? 'public' : 'private']);
  tags.push([meta.isOpen ? 'open' : 'closed']);
  return template(EDIT_METADATA_KIND, tags);
}

/** @param {string} groupId @param {string} pubkey @param {string[]} [roles] */
export function buildPutUserTemplate(groupId, pubkey, roles = []) {
  const p = roles.length > 0 ? ['p', pubkey, ...roles] : ['p', pubkey];
  return template(PUT_USER_KIND, [['h', groupId], p]);
}

/** @param {string} groupId @param {string} pubkey */
export function buildRemoveUserTemplate(groupId, pubkey) {
  return template(REMOVE_USER_KIND, [
    ['h', groupId],
    ['p', pubkey]
  ]);
}

/** @param {string} groupId */
export function buildDeleteGroupTemplate(groupId) {
  return template(DELETE_GROUP_KIND, [['h', groupId]]);
}

/** 16 hex chars — the short relay-scoped id style Armada uses. */
export function generateGroupId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
