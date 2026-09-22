// App-wide "your verified address is ready" alert.
//
// The membership handle grant is not a Nostr event — useMembershipGrantState
// detects it by polling the deployment's `.well-known/nostr.json` — so it can
// never arrive through the inbox loaders. Before this store the only surface
// that noticed a grant was the Termi assistant's hint card; anyone who never
// opened the assistant simply never learned their address was approved.
//
// Mirrors pending-invites.svelte.js: module-level state that the bell count,
// the inbox dropdown/page rows and Termi's nip05 hint all read, started once
// from the root layout. `manager` is deliberately non-reactive (see
// accounts.svelte.js), and useMembershipGrantState reads `manager.active`
// inside its effects, so the hook is (re)hosted in a fresh $effect.root per
// `manager.active$` emission instead of once for the app's lifetime.
//
// The store also owns the one-click activation, so every entry point (Termi
// card, bell row, settings card) ends in the same confirmation modal.
//
// Import budget: inbox-service (static in Navbar → root layout) reads the
// count from here, so everything beyond the reactive state — the grant hook,
// the action runner, the modal store, SvelteKit navigation — is imported
// lazily when detection starts or an activation runs, never at module load.
import { manager } from '$lib/stores/accounts.svelte';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import {
  isNip05ReadyHintDismissed,
  markNip05ReadyHintDismissed
} from '$lib/stores/nip05-hint-flags.svelte.js';

/** How long to wait for the user's kind 0 before concluding it does not exist. */
const PROFILE_SETTLE_MS = 5000;

/**
 * @typedef {{
 *   state: 'none' | 'pending' | 'granted',
 *   address: string,
 *   activated: boolean,
 *   hasOther: boolean,
 *   hasProfile: boolean,
 *   profileSettled: boolean
 * }} HandleGrant
 */

/** @type {HandleGrant} */
const EMPTY_GRANT = {
  state: 'none',
  address: '',
  activated: false,
  hasOther: false,
  hasProfile: false,
  profileSettled: false
};

/** @type {HandleGrant} */
let grant = $state.raw(EMPTY_GRANT);
/** @type {string | null} */
let activePubkey = $state(null);
let activating = $state(false);
/** @type {import('rxjs').Subscription | undefined} */
let accountSub;
/** @type {(() => void) | undefined} */
let destroyRoot;
/** Bumped per account emission so a late-resolving host for a previous account is dropped. */
let hostGeneration = 0;

/**
 * Host the grant hook + kind-0 subscription for one account.
 * @param {string} pubkey
 * @param {number} generation
 */
async function hostFor(pubkey, generation) {
  const [{ useMembershipGrantState }, { eventStore }, { getProfileNip05s }] = await Promise.all([
    import('$lib/stores/membership-grant.svelte.js'),
    import('$lib/stores/nostr-infrastructure.svelte'),
    import('$lib/helpers/nip05-verify.js')
  ]);
  if (generation !== hostGeneration) return;

  destroyRoot?.();
  destroyRoot = $effect.root(() => {
    const membership = useMembershipGrantState();

    /** @type {string[]} */
    let profileNip05s = $state.raw([]);
    let hasProfile = $state(false);
    let profileSettled = $state(false);

    // Own kind 0 (loaded app-wide for the navbar). Like Termi's hint, only
    // conclude "not activated" once the profile arrived or the settle timeout
    // passed — never over a profile we simply have not fetched yet.
    $effect(() => {
      const sub = eventStore.replaceable(0, pubkey).subscribe((event) => {
        if (!event) return;
        hasProfile = true;
        profileNip05s = getProfileNip05s(event);
        profileSettled = true;
      });
      const timeout = setTimeout(() => {
        profileSettled = true;
      }, PROFILE_SETTLE_MS);
      return () => {
        sub.unsubscribe();
        clearTimeout(timeout);
      };
    });

    $effect(() => {
      const address = membership.getAddress();
      const lower = address.toLowerCase();
      grant = {
        state: membership.getState(),
        address,
        activated: !!address && profileNip05s.some((a) => a.toLowerCase() === lower),
        hasOther: profileNip05s.some((a) => a.toLowerCase() !== lower),
        hasProfile,
        profileSettled
      };
    });
  });
}

/**
 * Start grant detection. Idempotent; the root layout calls it once in the
 * browser. Follows account switches through `manager.active$`.
 */
export function initNip05ReadyAlert() {
  if (accountSub) return;
  accountSub = manager.active$.subscribe((account) => {
    hostGeneration += 1;
    destroyRoot?.();
    destroyRoot = undefined;
    grant = EMPTY_GRANT;
    activating = false;
    activePubkey = account?.pubkey ?? null;
    if (account) hostFor(account.pubkey, hostGeneration);
  });
}

/** Tear the detection down (tests; the app keeps it for its lifetime). */
export function stopNip05ReadyAlert() {
  hostGeneration += 1;
  accountSub?.unsubscribe();
  accountSub = undefined;
  destroyRoot?.();
  destroyRoot = undefined;
  grant = EMPTY_GRANT;
  activePubkey = null;
  activating = false;
}

/** @returns {HandleGrant} reactive grant snapshot (Termi's hint reads this) */
export function getHandleGrant() {
  return grant;
}

/**
 * The alert to surface, or null. Shown while the deployment offers handles,
 * the grant is in, the profile settled without the address, and the user has
 * not dismissed the ready hint (flag shared with Termi's card).
 * @returns {{ address: string, hasOther: boolean, hasProfile: boolean } | null}
 */
export function getNip05ReadyAlert() {
  const pubkey = activePubkey;
  const membership = runtimeConfig.membership;
  if (!pubkey || !membership?.enabled || !membership?.handleDomain) return null;
  const g = grant;
  if (g.state !== 'granted' || !g.address || !g.profileSettled || g.activated) return null;
  if (isNip05ReadyHintDismissed(pubkey)) return null;
  return { address: g.address, hasOther: g.hasOther, hasProfile: g.hasProfile };
}

/** @returns {number} 0 or 1 — what the bell adds for this alert */
export function getNip05ReadyCount() {
  return getNip05ReadyAlert() ? 1 : 0;
}

/** @returns {boolean} whether a one-click activation is in flight */
export function isActivatingHandle() {
  return activating;
}

/**
 * One-click activation: publish the granted address as the profile's nip05.
 * Hands over to the settings card when another address exists (it offers
 * replace-or-add) or when there is no kind 0 yet (UpdateProfile would throw).
 * On success the shared confirmation modal opens; the kind-0 subscription
 * flips every surface to "activated" reactively.
 *
 * @returns {Promise<'activated' | 'settings' | 'failed' | 'noop'>}
 */
export async function activateGrantedHandle() {
  const g = grant;
  if (g.state !== 'granted' || !g.address) return 'noop';
  if (g.hasOther || !g.hasProfile) {
    const { goto } = await import('$app/navigation');
    goto('/settings');
    return 'settings';
  }
  if (activating) return 'noop';
  activating = true;
  try {
    const [{ actionRunner }, { UpdateProfile }] = await Promise.all([
      import('$lib/stores/action-runner.svelte.js'),
      import('applesauce-actions/actions')
    ]);
    await actionRunner.run(UpdateProfile, { nip05: g.address });
  } catch {
    return 'failed';
  } finally {
    activating = false;
  }
  const { modalStore } = await import('$lib/stores/modal.svelte.js');
  modalStore.openModal('nip05Activated', { address: g.address });
  return 'activated';
}

/** Hide the alert everywhere (bell row, inbox rows, Termi card) for this account. */
export function dismissNip05ReadyAlert() {
  const pubkey = activePubkey;
  if (!pubkey) return;
  markNip05ReadyHintDismissed(pubkey);
}
