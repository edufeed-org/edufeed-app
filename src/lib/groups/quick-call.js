// Quick call: a room for one ad-hoc call, started from a direct message.
//
// The room is a standalone ephemeral group (docs/nips/nip29-ephemeral-groups.md,
// "Without a parent"): the RELAY ends it — when its call is over, when the
// call never started, or with the relay's own deadline — so nothing is left
// behind when a browser disappears. It is unlisted (`hidden`) and closed, and
// the other person gets in with a call pass (docs/nips/nip29-call-passes.md)
// that travels in the link: no seat on the roster, no account on the relay.
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { hasNip44 } from '$lib/helpers/nip44.js';
import {
  generateGroupId,
  buildCreateGroupTemplate,
  buildEditGroupMetadataTemplate,
  confirmGroupMetadata,
  publishToGroupRelay
} from './group-management.js';
import {
  buildCallPassTemplate,
  generatePassCode,
  hashPassCode,
  callLinkUrl,
  isPassCode
} from './call-passes.js';
import { parseGroupInput } from './groups.js';

/** How long the link works at most; the room usually ends long before. */
export const QUICK_CALL_TTL_S = 12 * 3600;

/**
 * Create the room and a guest link for it. Throws with the relay's reason
 * when the relay refuses (an account that may not create groups there, a
 * relay without standalone ephemeral groups).
 * @param {{relay: string, user: {pubkey: string, signer: any}, origin: string, name: string}} args
 * @returns {Promise<{pointer: {id: string, relay: string}, url: string}>}
 */
export async function startQuickCall({ relay, user, origin, name }) {
  if (!hasNip44(user.signer)) throw new Error('nip44-unsupported');
  const relayConn = pool.relay(relay);
  const pointer = { id: generateGroupId(), relay };
  const metadata = {
    name,
    isPublic: true,
    isOpen: false,
    isHidden: true,
    livekit: true,
    ephemeralStandalone: true,
    // The relay ends the room when the call is over. The deadline is the
    // safety net for an end it never hears of, and matches the link's life.
    until: Math.floor(Date.now() / 1000) + QUICK_CALL_TTL_S
  };
  await publishToGroupRelay(relayConn, buildCreateGroupTemplate(pointer.id, metadata), user);
  await publishToGroupRelay(relayConn, buildEditGroupMetadataTemplate(pointer.id, metadata), user);
  if (!(await confirmGroupMetadata(relayConn, pointer.id))) {
    throw new Error('call room not confirmed by relay');
  }
  const code = generatePassCode();
  await publishToGroupRelay(
    relayConn,
    buildCallPassTemplate({
      groupId: pointer.id,
      codeHash: await hashPassCode(code),
      encryptedCode: await user.signer.nip44.encrypt(user.pubkey, code),
      expiration: Math.floor(Date.now() / 1000) + QUICK_CALL_TTL_S
    }),
    user
  );
  return { pointer, url: callLinkUrl(origin, pointer, code) };
}

// Any origin: the button keeps the link as written, like the group invite.
const CALL_URL_RE = /https?:\/\/[^\s/]+\/call\/([^\s#?/]+)#([A-Za-z0-9_-]+)/;

/**
 * A call link with its pass code inside a message, or null.
 * @param {string | null | undefined} content
 * @returns {{url: string, pointer: {id: string, relay: string}, code: string} | null}
 */
export function parseCallInvite(content) {
  const match = typeof content === 'string' ? content.match(CALL_URL_RE) : null;
  if (!match || !isPassCode(match[2])) return null;
  let pointer;
  try {
    pointer = parseGroupInput(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
  return pointer ? { url: match[0], pointer, code: match[2] } : null;
}

// The conversation a quick call was started or joined from, so the call page
// can lead back to it. One entry (the latest call) is enough; per tab.
const ORIGIN_KEY = 'quick-call-origin';

/** @param {{id: string}} pointer the call's room @param {string} pubkey the other person */
export function rememberCallOrigin(pointer, pubkey) {
  try {
    sessionStorage.setItem(ORIGIN_KEY, JSON.stringify({ id: pointer.id, pubkey }));
  } catch {
    // no storage: the call page falls back to the messages overview
  }
}

/** @param {{id: string}} pointer @returns {string | null} the other person's pubkey */
export function callOriginOf(pointer) {
  try {
    const origin = JSON.parse(sessionStorage.getItem(ORIGIN_KEY) ?? 'null');
    return origin?.id === pointer.id && /^[0-9a-f]{64}$/.test(origin.pubkey) ? origin.pubkey : null;
  } catch {
    return null;
  }
}
