<script>
  import { nip19 } from 'nostr-tools';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { EventFactory } from 'applesauce-core/event-factory';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { buildResponseTags } from '$lib/helpers/forms.js';
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';

  /** @type {{ data: { naddr: string } }} */
  let { data } = $props();

  let formEvent = $state(/** @type {import('nostr-tools').NostrEvent | null} */ (null));
  let isLoading = $state(true);
  let error = $state('');
  let isSubmitting = $state(false);
  let submitted = $state(false);

  // Decode naddr and load form template
  $effect(() => {
    let decoded;
    try {
      decoded = nip19.decode(data.naddr);
    } catch {
      error = 'Invalid form address';
      isLoading = false;
      return;
    }

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

    /** @type {import('rxjs').Subscription | undefined} */
    let modelSub;
    modelSub = eventStore.replaceable(30168, pubkey, identifier).subscribe((event) => {
      if (event) {
        formEvent = event;
        isLoading = false;
      }
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub?.unsubscribe();
    };
  });

  /** @param {Record<string, string>} values */
  async function handleSubmit(values) {
    if (!manager.active || !formEvent) return;

    isSubmitting = true;
    error = '';

    try {
      const decoded = nip19.decode(data.naddr);
      if (decoded.type !== 'naddr') return;
      const { pubkey: creatorPubkey, identifier } = decoded.data;
      const formAddress = `30168:${creatorPubkey}:${identifier}`;

      const responseTags = buildResponseTags(values);
      const isPublic = formEvent.tags.some((t) => t[0] === 'public');

      /** @type {string[][]} */
      const tags = [
        ['a', formAddress],
        ['p', creatorPubkey]
      ];

      let content = '';

      if (isPublic) {
        tags.push(...responseTags);
      } else {
        // Encrypt response tags with NIP-44
        const plaintext = JSON.stringify(responseTags);
        content = await manager.active.signer.nip44Encrypt(creatorPubkey, plaintext);
        tags.push(['encrypted']);
      }

      const factory = new EventFactory({ signer: manager.active.signer });
      const template = await factory.build({ kind: 1069, tags, content });
      const signed = await factory.sign(template);
      await publishEvent(signed);
      eventStore.add(signed);

      submitted = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to submit response';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="container mx-auto max-w-2xl p-4">
  {#if isLoading}
    <div class="flex justify-center p-8">
      <span class="loading loading-lg loading-spinner"></span>
    </div>
  {:else if error}
    <div class="alert alert-error">{error}</div>
  {:else if !manager.active}
    <div class="alert alert-warning">Log in with a signing key to submit this form.</div>
  {:else if formEvent && !formEvent.tags.some((t) => t[0] === 'public') && !manager.active?.signer?.nip44Encrypt}
    <div class="alert alert-warning">
      Your current signer does not support NIP-44 encryption, which is required for this form. Try a
      different login method.
    </div>
  {:else if submitted}
    <div class="alert alert-success">
      {formEvent?.tags.find((t) => t[0] === 'confirmation_message')?.[1] ||
        'Response submitted successfully!'}
    </div>
  {:else if formEvent}
    {#if isSubmitting}
      <div class="flex justify-center p-8">
        <span class="loading loading-lg loading-spinner"></span>
      </div>
    {:else}
      <FormRenderer {formEvent} onsubmit={handleSubmit} />
    {/if}
  {/if}
</div>
