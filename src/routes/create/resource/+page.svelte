<!--
  Thin redirector for the legacy `/create/resource` entrypoint.

  Resolves the metadata-form variant and redirects to the variant-addressed
  route `/create/resource/<variantId>`:
    - `?edit=<naddr>` → resolve the event and read its NIP-32
      `metadata-form` label tag to pick the variant; fallback to the default
      variant for legacy/untagged events.
    - otherwise → use the default variant.
  Preserves `?community=` and `?edit=` query params across the redirect.
-->

<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve as _resolve } from '$app/paths';
  import { fetchEventById } from '$lib/helpers/nostrUtils.js';
  import { resolveVariantIdFromEvent } from '$lib/helpers/educational/resolveVariantFromEvent.js';
  import { getDefaultVariantId } from '$lib/config/resource-form-variants.js';
  import { configReady } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);

  /** @type {{ data: { communityPubkey: string, editNaddr: string } }} */
  let { data } = $props();

  let error = $state('');

  onMount(async () => {
    // Variant registry reads from runtime config; wait for it before deciding.
    await new Promise((done) => {
      const unsub = configReady.subscribe((ready) => {
        if (ready) {
          unsub();
          done(undefined);
        }
      });
    });

    try {
      let variantId = getDefaultVariantId();

      if (data.editNaddr) {
        const event = await fetchEventById(data.editNaddr);
        if (event) {
          variantId = resolveVariantIdFromEvent(event);
        }
      }

      const queryParts = [];
      if (data.communityPubkey)
        queryParts.push(`community=${encodeURIComponent(data.communityPubkey)}`);
      if (data.editNaddr) queryParts.push(`edit=${encodeURIComponent(data.editNaddr)}`);
      const query = queryParts.join('&');
      const target = resolve(`/create/resource/${variantId}${query ? `?${query}` : ''}`);

      await goto(target, { replaceState: true });
    } catch (err) {
      console.error('Failed to resolve resource variant for redirect:', err);
      error = m.create_edit_error_resource_load();
    }
  });
</script>

<div class="flex min-h-[calc(100vh-4rem)] items-center justify-center">
  {#if error}
    <div class="mx-auto max-w-2xl px-4">
      <div class="alert alert-error">
        <span>{error}</span>
      </div>
    </div>
  {:else}
    <span class="loading loading-lg loading-spinner text-primary"></span>
  {/if}
</div>
