<script>
  import { page } from '$app/stores';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { EventFactory } from 'applesauce-core/event-factory';
  import { addressLoader, timedPool } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import {
    buildResponseTags,
    decodeFormNaddr,
    buildUserResponseFilter
  } from '$lib/helpers/forms.js';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';

  /** @type {{ data: { naddr: string } }} */
  let { data } = $props();

  let formEvent = $state(/** @type {import('nostr-tools').NostrEvent | null} */ (null));
  let isLoading = $state(true);
  let error = $state('');
  let isSubmitting = $state(false);
  let submitted = $state(false);
  let alreadyResponded = $state(false);

  /** @type {{ pubkey: string, identifier: string } | null} */
  let decodedForm = $state(null);

  let returnTo = $derived($page.url.searchParams.get('returnTo'));

  // Decode naddr and load form template
  $effect(() => {
    const decoded = decodeFormNaddr(data.naddr);
    if (decoded.error) {
      error = decoded.error;
      isLoading = false;
      return;
    }

    const pubkey = /** @type {string} */ (decoded.pubkey);
    const identifier = /** @type {string} */ (decoded.identifier);
    decodedForm = { pubkey, identifier };

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

  // Check if user already submitted a response
  $effect(() => {
    if (!decodedForm || !manager.active) return;

    const formAddress = `30168:${decodedForm.pubkey}:${decodedForm.identifier}`;
    const filter = buildUserResponseFilter(formAddress, manager.active.pubkey);
    const relays = getCommunikeyRelays();

    const loaderSub = createTimelineLoader(timedPool, relays, filter, {
      eventStore,
      limit: 1
    })().subscribe();

    const modelSub = eventStore.timeline(filter).subscribe((events) => {
      if (events && events.length > 0) {
        alreadyResponded = true;
      }
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  /** @param {Record<string, string>} values */
  async function handleSubmit(values) {
    if (!manager.active || !formEvent || !decodedForm) return;

    isSubmitting = true;
    error = '';

    try {
      const { pubkey: creatorPubkey, identifier } = decodedForm;
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
  {:else if alreadyResponded && !submitted}
    <div class="mb-4 alert alert-warning">You've already submitted a response to this form.</div>
    {#if returnTo}
      <a href={returnTo} class="btn btn-primary">Back to community</a>
    {:else}
      <button class="btn btn-primary" onclick={() => history.back()}>Go back</button>
    {/if}
  {:else if submitted}
    <div class="mb-4 alert alert-success">
      {formEvent?.tags.find((t) => t[0] === 'confirmation_message')?.[1] ||
        'Response submitted successfully!'}
    </div>
    {#if returnTo}
      <a href={returnTo} class="btn btn-primary">Back to community</a>
    {:else}
      <button class="btn btn-primary" onclick={() => history.back()}>Go back</button>
    {/if}
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
