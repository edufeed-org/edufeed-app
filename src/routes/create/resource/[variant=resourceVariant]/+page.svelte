<script>
  import { nip19 } from 'nostr-tools';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { resolve as _resolve } from '$app/paths';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import ResourceFormWizard from '$lib/components/educational/ResourceFormWizard.svelte';
  import { fetchEventById } from '$lib/helpers/nostrUtils';
  import { formatAMBResource } from '$lib/helpers/educational';
  import { runtimeConfig, configReady } from '$lib/stores/config.svelte.js';
  import { getEnabledVariants, getDefaultVariantId } from '$lib/config/resource-form-variants.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);

  /** @type {{ data: { variantId: string, communityPubkey: string, editNaddr: string } }} */
  let { data } = $props();

  // Edit mode state
  let editEvent = $state(/** @type {any} */ (null));
  let editResource = $state(/** @type {any} */ (null));
  let isLoadingEdit = $state(false);
  let editError = $state('');
  // True while we're awaiting runtime config to decide whether to redirect a
  // registered-but-disabled variant id to the default. Matchers can't do this
  // check themselves (see src/params/resourceVariant.js).
  let isResolvingVariant = $state(true);

  const isEditMode = $derived(!!data.editNaddr);

  onMount(async () => {
    // Wait for runtime config to load. Skip the subscription entirely when
    // it's already ready — otherwise subscribe()'s callback fires
    // synchronously and references `unsub` before assignment (TDZ).
    if (!get(configReady)) {
      await new Promise((done) => {
        const unsub = configReady.subscribe((ready) => {
          if (ready) {
            unsub();
            done(undefined);
          }
        });
      });
    }

    const enabled = getEnabledVariants();
    if (!enabled.some((v) => v.id === data.variantId)) {
      // Variant is registered but not enabled on this deployment — redirect
      // to the default variant, preserving ?community= and ?edit=.
      const queryParts = [];
      if (data.communityPubkey)
        queryParts.push(`community=${encodeURIComponent(data.communityPubkey)}`);
      if (data.editNaddr) queryParts.push(`edit=${encodeURIComponent(data.editNaddr)}`);
      const query = queryParts.join('&');
      const target = resolve(
        `/create/resource/${getDefaultVariantId()}${query ? `?${query}` : ''}`
      );
      await goto(target, { replaceState: true });
      return;
    }

    isResolvingVariant = false;
  });

  // Resolve edit naddr to event
  $effect(() => {
    if (!data.editNaddr) return;

    isLoadingEdit = true;
    editError = '';

    (async () => {
      try {
        const decoded = nip19.decode(data.editNaddr);
        if (decoded.type !== 'naddr') {
          editError = m.create_edit_error_invalid_address();
          return;
        }

        const event = await fetchEventById(data.editNaddr);
        if (!event) {
          editError = m.create_edit_error_resource_not_found();
          return;
        }

        editEvent = event;
        editResource = formatAMBResource(event);
      } catch (err) {
        console.error('Error loading resource for edit:', err);
        editError = m.create_edit_error_resource_load();
      } finally {
        isLoadingEdit = false;
      }
    })();
  });

  function handleBack() {
    history.back();
  }
</script>

<svelte:head>
  <title
    >{isEditMode ? m.create_resource_title_edit() : m.create_resource_title_create()} - {runtimeConfig.appName}</title
  >
</svelte:head>

<div class="min-h-[calc(100vh-4rem)]">
  <!-- Top bar -->
  <div>
    <div class="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
      <button class="btn btn-ghost btn-sm" onclick={handleBack} aria-label={m.aria_go_back()}>
        <ChevronLeftIcon class_="w-5 h-5" />
      </button>
      <h1 class="text-lg font-semibold text-base-content">
        {isEditMode ? m.create_resource_title_edit() : m.create_resource_title_create()}
      </h1>
    </div>
  </div>

  <!-- Content -->
  {#if isResolvingVariant || isLoadingEdit}
    <div class="flex items-center justify-center py-20">
      <span class="loading loading-lg loading-spinner text-primary"></span>
    </div>
  {:else if editError}
    <div class="mx-auto max-w-2xl px-4 py-10">
      <div class="alert alert-error">
        <span>{editError}</span>
      </div>
      <button class="btn mt-4 btn-outline" onclick={handleBack}>{m.create_go_back()}</button>
    </div>
  {:else}
    <ResourceFormWizard
      communityPubkey={data.communityPubkey}
      {editEvent}
      {editResource}
      variantId={data.variantId}
    />
  {/if}
</div>
