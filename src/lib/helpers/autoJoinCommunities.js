import { nip19 } from 'nostr-tools';

const COMMUNITIES_SET_ID = 'communities';

/**
 * Normalize an npub or hex pubkey to lowercase hex. Returns null if invalid.
 * Inlined (rather than importing `normalizeToHex` from nostrUtils.js) so this
 * module stays leaf-level — nostrUtils.js drags in relay-helper / app-settings,
 * which require `window` and pull stores into a Node test environment.
 *
 * @param {unknown} identifier
 * @returns {string | null}
 */
function normalizeToHex(identifier) {
  if (!identifier || typeof identifier !== 'string') return null;
  if (/^[0-9a-f]{64}$/i.test(identifier)) return identifier.toLowerCase();
  if (!identifier.startsWith('npub1')) return null;
  try {
    const decoded = nip19.decode(identifier);
    return decoded.type === 'npub' ? decoded.data : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} SignerLike
 * @property {(event: {kind: number, created_at: number, tags: string[][], content: string, pubkey: string}) => Promise<import('nostr-tools').NostrEvent>} signEvent
 */

/**
 * Build and sign a kind 30000 follow set event listing the configured
 * communities, ready for optimistic insertion into EventStore.
 *
 * Bypasses ActionRunner / joinCommunities on purpose: this is the brand-new
 * account path, where we know there's no existing follow set to merge into.
 * Shaping the event ourselves lets the caller add it to EventStore *before*
 * publishing, so the UI updates instantly while relays catch up in background.
 *
 * Filters out invalid identifiers; returns `signed: null` when nothing valid
 * remains. Never throws on bad input — only on signer failure.
 *
 * @param {SignerLike} signer - The new account's signer (e.g. SimpleSigner).
 * @param {string} pubkey - The new account's pubkey (hex).
 * @param {string[] | undefined} identifiers - npub or hex pubkeys to follow.
 * @returns {Promise<{signed: import('nostr-tools').NostrEvent | null, targetPubkeys: string[]}>}
 */
export async function buildAutoJoinFollowSet(signer, pubkey, identifiers) {
  if (!identifiers?.length) {
    return { signed: null, targetPubkeys: [] };
  }

  const targetPubkeys = identifiers
    .map((id) => normalizeToHex(id))
    .filter(/** @returns {pk is string} */ (pk) => pk !== null);

  if (targetPubkeys.length === 0) {
    return { signed: null, targetPubkeys: [] };
  }

  const event = {
    kind: 30000,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', COMMUNITIES_SET_ID],
      ...targetPubkeys.map((pk) => /** @type {string[]} */ (['p', pk]))
    ],
    content: '',
    pubkey
  };

  const signed = await signer.signEvent(event);
  return { signed, targetPubkeys };
}
