<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import MembershipApprovalsPanel from '$lib/components/membership/MembershipApprovalsPanel.svelte';

  const cfg = $derived(runtimeConfig.membership);
  const adminPubkeys = $derived(cfg?.adminPubkeys || []);
  const formAddress = $derived(cfg?.formAddress || '');
  // The kind 30168 template author is embedded in the form address
  // (30168:pubkey:d-tag) — independent of the admin list's order.
  const formAuthorPubkey = $derived(formAddress.split(':')[1] || adminPubkeys[0] || '');
  // d-tags may themselves contain colons, so rejoin everything after the pubkey.
  const formIdentifier = $derived(
    formAddress.split(':').slice(2).join(':') || 'edufeed-membership'
  );

  // `manager.active` is an RxJS-backed property (not a Svelte rune), so we
  // subscribe to `manager.active$` and mirror into local $state for reactivity.
  let activeAccount = $state(/** @type {any} */ (null));
  $effect(() => {
    const sub = manager.active$.subscribe((account) => {
      activeAccount = account;
    });
    return () => sub.unsubscribe();
  });
  const activePubkey = $derived(activeAccount?.pubkey || '');
  const isAuthorized = $derived(!!activePubkey && adminPubkeys.includes(activePubkey));

  /** @type {import('nostr-tools').NostrEvent | null} */
  let formEvent = $state(null);
  let isLoadingForm = $state(true);

  $effect(() => {
    if (!isAuthorized || !formAuthorPubkey) return;
    const relays = getCommunikeyRelays();
    const loaderSub = addressLoader({
      kind: 30168,
      pubkey: formAuthorPubkey,
      identifier: formIdentifier,
      relays
    }).subscribe();

    const modelSub = eventStore
      .replaceable(30168, formAuthorPubkey, formIdentifier)
      .subscribe((event) => {
        if (event) {
          formEvent = event;
          isLoadingForm = false;
        }
      });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });
</script>

<svelte:head>
  <title>{m.admin_membership_title()}</title>
</svelte:head>

<div class="container mx-auto max-w-4xl p-4">
  <h1 class="mb-2 text-3xl font-bold">{m.admin_membership_title()}</h1>
  <p class="mb-6 text-base-content/70">{m.admin_membership_subtitle()}</p>

  {#if !activePubkey}
    <div class="alert alert-warning">{m.admin_membership_login_required()}</div>
  {:else if !isAuthorized}
    <div class="alert alert-error">{m.admin_membership_not_authorized()}</div>
  {:else if isLoadingForm && !formEvent}
    <div class="flex justify-center p-8">
      <span class="loading loading-lg loading-spinner"></span>
      <span class="ml-2">{m.admin_membership_loading_form()}</span>
    </div>
  {:else if formEvent}
    <MembershipApprovalsPanel {formEvent} />
  {/if}
</div>
