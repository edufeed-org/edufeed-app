<script>
  import { nip19 } from 'nostr-tools';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import AMBResourceForm from '$lib/components/educational/AMBResourceForm.svelte';
  import { fetchEventById } from '$lib/helpers/nostrUtils';
  import { formatAMBResource } from '$lib/helpers/educational';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ data: { communityPubkey: string, editNaddr: string } }} */
  let { data } = $props();

  // Edit mode state
  let editEvent = $state(/** @type {any} */ (null));
  let editResource = $state(/** @type {any} */ (null));
  let isLoadingEdit = $state(false);
  let editError = $state('');

  const isEditMode = $derived(!!data.editNaddr);

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
  <div class="border-b border-base-300 bg-base-100">
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
  {#if isLoadingEdit}
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
    <AMBResourceForm communityPubkey={data.communityPubkey} {editEvent} {editResource} />
  {/if}
</div>
