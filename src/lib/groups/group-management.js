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
  DELETE_GROUP_KIND,
  DELETE_EVENT_KIND,
  GROUP_METADATA_KIND,
  GROUP_ADMINS_KIND
} from 'applesauce-common/helpers/groups';
import { firstValueFrom } from 'rxjs';
import { defaultIfEmpty } from 'rxjs/operators';
import { authenticateOnce } from './relay-auth.js';

const now = () => Math.floor(Date.now() / 1000);
/** @param {number} kind @param {string[][]} tags */
const template = (kind, tags) => ({ kind, content: '', created_at: now(), tags });

/**
 * The metadata tag block shared by create (9007) and edit (9002): fields only
 * when non-empty after trim, then BOTH marker sides so a flip always
 * overwrites.
 * @param {{name?: string, about?: string, picture?: string, isPublic: boolean, isOpen: boolean, parent?: string}} meta
 * @returns {string[][]}
 */
function metadataTags(meta) {
  /** @type {string[][]} */
  const tags = [];
  for (const key of /** @type {const} */ (['name', 'about', 'picture'])) {
    const value = meta[key]?.trim();
    if (value) tags.push([key, value]);
  }
  tags.push([meta.isPublic ? 'public' : 'private']);
  tags.push([meta.isOpen ? 'open' : 'closed']);
  // "Open" always means open to READ. Without `restricted`, NIP-29 lets the
  // whole network WRITE into the group — design round 4 (buzz thread):
  // "restricted bleibt in allen drei Stufen gesetzt".
  tags.push(['restricted']);
  // NIP-29 Subgroups: declares the community's root group as this channel's
  // parent so a relay-side patch can auto-admit root-group members. Only
  // meaningful when both groups live on the same relay (the tag is
  // relay-scoped) — callers are responsible for that check.
  if (meta.parent) tags.push(['parent', meta.parent]);
  return tags;
}

/**
 * The 9007 carries the metadata inline: name-validating relays (buzz 0.2.0:
 * "invalid: channel name is required") reject a bare ["h", id] create, and
 * relays that read metadata only from 9002 ignore the extra tags (khatru,
 * measured on groups.0xchat.com).
 * @param {string} groupId
 * @param {{name?: string, about?: string, picture?: string, isPublic: boolean, isOpen: boolean, parent?: string}} [meta]
 */
export function buildCreateGroupTemplate(groupId, meta) {
  return template(CREATE_GROUP_KIND, [['h', groupId], ...(meta ? metadataTags(meta) : [])]);
}

/**
 * @param {string} groupId
 * @param {{name?: string, about?: string, picture?: string, isPublic: boolean, isOpen: boolean, parent?: string}} meta
 */
export function buildEditGroupMetadataTemplate(groupId, meta) {
  return template(EDIT_METADATA_KIND, [['h', groupId], ...metadataTags(meta)]);
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

/**
 * NIP-29 delete-event (9005): an admin removes someone else's event from the
 * group. The relay drops it from its store; clients drop it from view.
 * @param {string} groupId @param {string} eventId
 */
export function buildDeleteEventTemplate(groupId, eventId) {
  return template(DELETE_EVENT_KIND, [
    ['h', groupId],
    ['e', eventId]
  ]);
}

/** 16 hex chars — the short relay-scoped id style Armada uses. */
export function generateGroupId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 12 chars from unambiguous alphabet (no 0/O/1/l/i/I/L/o) for invite codes.
 * @returns {string}
 */
export function generateInviteCode() {
  // Unambiguous alphabet: excludes 0/O/1/l/i/I/L/o (commonly confused).
  // Modulo bias is accepted at 12 chars / 54-char alphabet.
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** @param {string} groupId @param {string} code */
export function buildCreateInviteTemplate(groupId, code) {
  return template(9009, [
    ['h', groupId],
    ['code', code]
  ]);
}

/**
 * Publish while answering any NIP-42 challenge the relay presents mid-flight.
 * Some relays (groups.0xchat.com, measured 2026-08-14) challenge on connect
 * and silently HOLD every OK until the client authenticates — no auth-required
 * NAK ever arrives. Answering the challenge makes the relay release the held
 * OK for the event we already sent, so the pending publish resolves by itself.
 * @param {any} relayConn
 * @param {any} signed
 * @param {any} signer
 */
async function publishAnsweringChallenge(relayConn, signed, signer) {
  const sub = relayConn.challenge$?.subscribe?.((/** @type {string | null} */ challenge) => {
    if (challenge && !relayConn.authenticated) void authenticateOnce(relayConn, signer);
  });
  try {
    return await relayConn.publish(signed);
  } finally {
    sub?.unsubscribe?.();
  }
}

/**
 * True when a group-relay rejection means the account isn't on the pyramid's
 * create-group whitelist (groups.edufeed.org: "restricted: only members of
 * this relay can create a group"). Kept distinct from other `restricted:`
 * reasons so the UI can show a friendly ask-the-operator message instead of
 * the raw relay text.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRelayMembershipRequired(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /only members of this relay can create a group/i.test(message);
}

/**
 * Sign as `user` and publish to the group relay ONLY. One NIP-42 retry when
 * the relay answers auth-required — or answers nothing at all (applesauce
 * reports the withheld OK as a `Timeout` NAK after 10s). One re-sign+retry
 * when the relay answers "too old" — the pyramid rejects moderation actions
 * (9000-9009) whose created_at is more than 60s in the past, which a slow
 * NIP-46 bunker approval can trip since created_at is stamped at template
 * build time, before the user approves. Every other rejection throws with
 * the relay's reason so the UI can show it.
 * @param {any} relayConn a pool.relay(url) connection
 * @param {any} template
 * @param {{pubkey: string, signer: any}} user
 */
export async function publishToGroupRelay(relayConn, template, user) {
  let signed = await user.signer.signEvent({ ...template, pubkey: user.pubkey });
  let response = await publishAnsweringChallenge(relayConn, signed, user.signer);
  if (response?.ok === false) {
    const reason = String(response.message ?? '');
    if (reason.startsWith('auth-required') || reason === 'Timeout') {
      const auth = await authenticateOnce(relayConn, user.signer);
      if (auth.ok) response = await relayConn.publish(signed);
    } else if (/too old/i.test(reason)) {
      signed = await user.signer.signEvent({ ...template, created_at: now(), pubkey: user.pubkey });
      response = await publishAnsweringChallenge(relayConn, signed, user.signer);
    }
  }
  if (response && response.ok === false) {
    throw new Error(response.message || 'relay rejected the event');
  }
  return signed;
}

/** First kind-39000 for this id from the relay, or null. @param {any} relayConn @param {string} groupId */
export function confirmGroupMetadata(relayConn, groupId) {
  return firstValueFrom(
    relayConn
      .request({ kinds: [GROUP_METADATA_KIND], '#d': [groupId] }, { timeout: 10000 })
      .pipe(defaultIfEmpty(null))
  );
}

/** First kind-39001 (admins) for this id from the relay, or null. @param {any} relayConn @param {string} groupId */
export function confirmGroupAdmins(relayConn, groupId) {
  return firstValueFrom(
    relayConn
      .request({ kinds: [GROUP_ADMINS_KIND], '#d': [groupId] }, { timeout: 8000 })
      .pipe(defaultIfEmpty(null))
  );
}

/**
 * 9007 create → 9002 metadata → confirm the relay's 39000. Metadata rides the
 * 9002 (relays are not required to honour it on the 9007 itself). A group
 * created but not confirmed is recoverable via attach-existing.
 * @param {{relayConn: any, id: string, metadata: any, user: {pubkey: string, signer: any}}} args
 */
export async function createGroupOnRelay({ relayConn, id, metadata, user }) {
  await publishToGroupRelay(relayConn, buildCreateGroupTemplate(id, metadata), user);
  await publishToGroupRelay(relayConn, buildEditGroupMetadataTemplate(id, metadata), user);
  // Give the relay a beat to materialise its addressables before we ask.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const confirmed = await confirmGroupMetadata(relayConn, id);
  if (!confirmed) throw new Error('group not confirmed by relay');
  return confirmed;
}
