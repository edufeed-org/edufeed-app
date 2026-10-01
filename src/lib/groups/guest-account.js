// A guest from a call link: name → fresh key in this browser → active
// account → a real kind 0 with just the name (so every client, Armada
// included, shows it). The signup wizard's step-1 mechanism, without the
// wizard. The key stays in the browser like any signup; the existing
// backup hint (keyed on `signed-up-here:`) offers to save it later.
import { SimpleAccount } from 'applesauce-accounts/accounts';
import { manager } from '$lib/stores/accounts.svelte';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { publishEvent } from '$lib/services/publish-service.js';
import { buildSignedDefaultRelayList } from '$lib/services/relay-list-backfill.js';
import { generateSignupKeypair } from '$lib/helpers/signupKeypair.js';

/** @param {string} pk */
const GUEST_FLAG = (pk) => `call-guest:${pk}`;
/** @param {string} pk */
const SIGNUP_FLAG = (pk) => `signed-up-here:${pk}`;

/** @param {string} key @param {string | null} value */
function setFlag(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the hints simply do not show
  }
}

/**
 * Create a fresh key, make it the active account, and publish a name-only
 * kind 0 — the mechanism behind the signup wizard's step 1, without the
 * wizard. Used by guests arriving from a call link.
 *
 * @param {string} name
 * @returns {Promise<{pubkey: string, signer: any}>}
 */
export async function createGuestAccount(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('name-required');
  const { publicKey, signer } = generateSignupKeypair();
  // Loosely typed like SignupModal's `_signer`: SimpleSigner's strict
  // EventTemplate type rejects the `pubkey` field we pass alongside kind/
  // created_at/tags/content (same shape the signup wizard signs).
  const anySigner = /** @type {any} */ (signer);
  const account = new SimpleAccount(publicKey, signer);
  manager.addAccount(account);
  manager.setActive(account);
  setFlag(SIGNUP_FLAG(publicKey), '1');
  setFlag(GUEST_FLAG(publicKey), '1');

  const kind0 = await anySigner.signEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify({ name: trimmed }),
    pubkey: publicKey
  });
  eventStore.add(kind0);
  publishEvent(kind0).catch((err) => console.warn('guest kind 0 publish failed:', err));
  const relayList = await buildSignedDefaultRelayList(signer).catch(() => null);
  if (relayList) {
    eventStore.add(relayList);
    publishEvent(relayList).catch((err) => console.warn('guest kind 10002 publish failed:', err));
  }
  return { pubkey: publicKey, signer };
}

/** @param {string} pubkey */
export function isCallGuest(pubkey) {
  try {
    return !!pubkey && localStorage.getItem(GUEST_FLAG(pubkey)) === '1';
  } catch {
    return false;
  }
}

/** "Vergessen": log out and drop the key from this browser. @param {string} pubkey */
export function forgetGuestAccount(pubkey) {
  const account = manager.getAccountForPubkey(pubkey);
  if (account) manager.removeAccount(account);
  setFlag(GUEST_FLAG(pubkey), null);
  setFlag(SIGNUP_FLAG(pubkey), null);
}
