/**
 * Reactive count of pending membership applications for the active admin.
 *
 * Mirrors the loader/model setup of `MembershipApprovalsPanel.svelte` but
 * exposes only the count — no decryption, no upstream NIP-05 check. Cheap
 * enough for navbar/menu indicators.
 *
 * Slightly overcounts: already-approved rows still contribute until the admin
 * removes them. Acceptable tradeoff for a nudge-style indicator.
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

    if (!enabled || !isAdmin || !formAddress || !adminPubkey) {
      count = 0;
      return;
    }

    const loader = formResponseLoader(formAddress, adminPubkey);
    const loaderSub = loader().subscribe();
    const modelSub = eventStore.model(TimelineModel, { kinds: [1069] }).subscribe((events) => {
      /** @type {Record<string, true>} */
      let rejectedIds = {};
      try {
        const raw =
          typeof window !== 'undefined' ? window.localStorage.getItem(rejectedKey(pubkey)) : null;
        const list = /** @type {string[]} */ (raw ? JSON.parse(raw) : []);
        for (const id of list) rejectedIds[id] = true;
      } catch {
        // localStorage unavailable — treat nothing as rejected.
      }

      const matching = (events || []).filter((e) =>
        e.tags.some((t) => t[0] === 'a' && t[1] === formAddress)
      );
      count = matching.filter((e) => !rejectedIds[e.id]).length;
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  return () => count;
}
