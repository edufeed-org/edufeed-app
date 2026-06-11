/**
 * Reactive count of *unprocessed* membership applications for the active admin.
 *
 * Loads kind 1069 responses for the configured form, then excludes:
 *   - locally-rejected rows (localStorage set, mirrors MembershipApprovalsPanel)
 *   - rows whose applicant pubkey is already in the upstream NIP-05 directory
 *     (i.e. already approved — fetched once from `/.well-known/nostr.json`,
 *     re-fetched on `window.focus` so coming back to the tab after upstream
 *     work refreshes the badge)
 *
 * No decryption involved. The well-known endpoint returns the full directory
 * when called without a `name=` parameter, so one HTTPS call covers all rows.
 */
import { manager } from '$lib/stores/accounts.svelte';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { TimelineModel } from 'applesauce-core/models';
import { formResponseLoader } from '$lib/loaders/community.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

/** @param {string} pubkey */
function rejectedKey(pubkey) {
  return `membership-rejected:${pubkey}`;
}

/**
 * Hook returning a getter for the pending-applications count. Returns 0 when
 * membership is disabled, when there is no active account, or when the active
 * account is not on the admin allowlist.
 *
 * @returns {() => number}
 */
export function useMembershipPendingCount() {
  let count = $state(0);

  $effect(() => {
    const pubkey = manager.active?.pubkey;
    const cfg = runtimeConfig.membership;
    const enabled = !!cfg?.enabled;
    const adminPubkeys = cfg?.adminPubkeys || [];
    const isAdmin = !!pubkey && adminPubkeys.includes(pubkey);
    const formAddress = cfg?.formAddress || '';
    const adminPubkey = adminPubkeys[0] || '';
    const handleDomain = cfg?.handleDomain || '';

    if (!enabled || !isAdmin || !formAddress || !adminPubkey || !pubkey) {
      count = 0;
      return;
    }
    const activePubkey = pubkey;

    /** @type {import('nostr-tools').NostrEvent[]} */
    let cachedEvents = [];
    /** @type {Record<string, true>} Pubkeys with an upstream NIP-05 entry. */
    let approvedPubkeys = {};

    function recompute() {
      /** @type {Record<string, true>} */
      let rejectedIds = {};
      try {
        const raw =
          typeof window !== 'undefined'
            ? window.localStorage.getItem(rejectedKey(activePubkey))
            : null;
        const list = /** @type {string[]} */ (raw ? JSON.parse(raw) : []);
        for (const id of list) rejectedIds[id] = true;
      } catch {
        // localStorage unavailable — treat nothing as rejected.
      }

      const matching = cachedEvents.filter((e) =>
        e.tags.some((t) => t[0] === 'a' && t[1] === formAddress)
      );
      count = matching.filter((e) => !rejectedIds[e.id] && !approvedPubkeys[e.pubkey]).length;
    }

    async function refreshApproved() {
      if (!handleDomain) return;
      try {
        const res = await fetch(`https://${handleDomain}/.well-known/nostr.json`);
        if (!res.ok) return;
        const json = await res.json();
        /** @type {Record<string, true>} */
        const next = {};
        for (const pk of Object.values(json?.names || {})) {
          if (typeof pk === 'string') next[pk] = true;
        }
        approvedPubkeys = next;
        recompute();
      } catch {
        // Network/CORS — leave approvedPubkeys as-is.
      }
    }

    refreshApproved();
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', refreshApproved);
    }

    const loader = formResponseLoader(formAddress, adminPubkey);
    const loaderSub = loader().subscribe();
    const modelSub = eventStore.model(TimelineModel, { kinds: [1069] }).subscribe((events) => {
      cachedEvents = events || [];
      recompute();
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', refreshApproved);
      }
    };
  });

  return () => count;
}
