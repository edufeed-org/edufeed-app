<script>
  import { nip19 } from 'nostr-tools';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import FormBuilder from '$lib/components/forms/FormBuilder.svelte';

  /** @type {{ data: { naddr: string } }} */
  let { data } = $props();

  let formEvent = $state(/** @type {import('nostr-tools').NostrEvent | null} */ (null));
  let isLoading = $state(true);
  let error = $state('');

  $effect(() => {
    const decoded = nip19.decode(data.naddr);
    if (decoded.type !== 'naddr') {
      error = 'Invalid form address';
      isLoading = false;
      return;
    }

    const { pubkey, identifier, kind } = decoded.data;
    if (kind !== 30168) {
      error = 'Not a form address';
      isLoading = false;
      return;
    }

    const relays = getCommunikeyRelays();
    const loaderSub = addressLoader({ kind: 30168, pubkey, identifier, relays }).subscribe();
    const modelSub = eventStore.replaceable(30168, pubkey, identifier).subscribe((event) => {
      if (event) {
        formEvent = event;
        isLoading = false;
      }
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });
</script>

<div class="container mx-auto max-w-3xl p-4">
  {#if isLoading}
    <div class="flex justify-center p-8">
      <span class="loading loading-lg loading-spinner"></span>
    </div>
  {:else if error}
    <div class="alert alert-error">{error}</div>
  {:else if formEvent}
    <FormBuilder existingEvent={formEvent} />
  {/if}
</div>
