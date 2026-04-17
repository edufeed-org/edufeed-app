<script>
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import { decodeFormNaddr, parseFormTemplate } from '$lib/helpers/forms.js';
  import { buildAMBResourceTags } from '$lib/helpers/form-to-amb.js';
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { factory } from '$lib/stores/action-runner.svelte.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { getEducationalRelays, getCommunikeyRelays } from '$lib/helpers/relay-helper.js';

  /** @type {{ data: { naddr: string } }} */
  let { data } = $props();

  const decoded = $derived(decodeFormNaddr(data.naddr));

  /** @type {import('nostr-tools').NostrEvent | undefined} */
  let formEvent = $state(undefined);
  let parsed = $derived(formEvent ? parseFormTemplate(formEvent) : undefined);
  let submitting = $state(false);
  let error = $state('');

  $effect(() => {
    if (decoded.error || !decoded.pubkey || !decoded.identifier) return;
    const pubkey = decoded.pubkey;
    const identifier = decoded.identifier;
    const relays = [...(decoded.relays || []), ...getCommunikeyRelays()];

    const loaderSub = addressLoader({ kind: 30168, pubkey, identifier, relays }).subscribe();
    const modelSub = eventStore.replaceable(30168, pubkey, identifier).subscribe((e) => {
      if (e) formEvent = e;
    });
    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  /** @param {Record<string, any>} values */
  async function handleSubmit(values) {
    if (!manager.active) {
      error = 'Bitte anmelden.';
      return;
    }
    if (!parsed || !decoded.pubkey || !decoded.identifier) return;
    submitting = true;
    error = '';
    try {
      /** @type {Record<string, any>} */
      const rawValues = {};
      /** @type {Record<string, any>} */
      const selectedConcepts = {};
      for (const field of parsed.fields) {
        const v = values[field.id];
        if (field.vocab && Array.isArray(v)) {
          selectedConcepts[field.id] = v;
          rawValues[field.id] = v.map((c) => c.id);
        } else {
          rawValues[field.id] = v;
        }
      }

      const dTag = crypto.randomUUID();
      const formRelay = (decoded.relays && decoded.relays[0]) || '';
      const tags = [
        ['d', dTag],
        ...buildAMBResourceTags({
          form: { pubkey: decoded.pubkey, dTag: decoded.identifier, fields: parsed.fields },
          formRelay,
          values: rawValues,
          selectedConcepts
        })
      ];

      const template = { kind: 30142, tags, content: rawValues.description || '' };
      const built = await factory.build(template);
      const signed = await factory.sign(built);
      eventStore.add(signed);
      await publishEvent(signed, []);

      const naddr = nip19.naddrEncode({
        kind: 30142,
        pubkey: signed.pubkey,
        identifier: dTag,
        relays: getEducationalRelays().slice(0, 2)
      });
      goto(`/${naddr}`);
    } catch (err) {
      console.error(err);
      error = err instanceof Error ? err.message : 'Veröffentlichung fehlgeschlagen';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="container mx-auto max-w-2xl p-4">
  {#if decoded.error}
    <div class="alert alert-error">{decoded.error}</div>
  {:else if !formEvent}
    <div class="flex justify-center p-8">
      <span class="loading loading-lg loading-spinner"></span>
    </div>
  {:else if !parsed}
    <div class="alert alert-error">Formular konnte nicht gelesen werden.</div>
  {:else if !manager.active}
    <div class="alert alert-warning">Bitte anmelden, um eine Ressource anzulegen.</div>
  {:else}
    <h1 class="mb-4 text-2xl font-bold">{parsed.name || 'Neue Ressource'}</h1>
    {#if parsed.description}
      <p class="mb-4 opacity-80">{parsed.description}</p>
    {/if}
    <FormRenderer {formEvent} onsubmit={handleSubmit} />
    {#if submitting}
      <p class="mt-4">Wird veröffentlicht …</p>
    {/if}
    {#if error}
      <p class="mt-4 text-error">{error}</p>
    {/if}
  {/if}
</div>
