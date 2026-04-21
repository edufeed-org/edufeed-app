<script>
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { decodeFormNaddr, parseFormTemplate, formEventToNaddr } from '$lib/helpers/forms.js';
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';
  import FormResponses from '$lib/components/forms/FormResponses.svelte';
  import SendFormModal from '$lib/components/forms/SendFormModal.svelte';
  import EventContextMenu from '$lib/components/shared/EventContextMenu.svelte';
  import { EditIcon, SendIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ data: { naddr: string, initialTab: string } }} */
  let { data } = $props();

  let formEvent = $state(/** @type {import('nostr-tools').NostrEvent | null} */ (null));
  let isLoading = $state(true);
  let error = $state('');
  // svelte-ignore state_referenced_locally
  let activeTab = $state(data.initialTab);

  /** @type {string} */
  let formAddress = $state('');

  $effect(() => {
    const decoded = decodeFormNaddr(data.naddr);
    if (decoded.error) {
      error = decoded.error;
      isLoading = false;
      return;
    }

    const pubkey = /** @type {string} */ (decoded.pubkey);
    const identifier = /** @type {string} */ (decoded.identifier);

    formAddress = `30168:${pubkey}:${identifier}`;
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

  const isOwner = $derived(
    formEvent && manager.active && formEvent.pubkey === manager.active.pubkey
  );

  const parsedForm = $derived(formEvent ? parseFormTemplate(formEvent) : null);
  const forkOf = $derived(parsedForm?.forkOf);

  let parentFormEvent = $state(/** @type {import('nostr-tools').NostrEvent | null} */ (null));

  $effect(() => {
    parentFormEvent = null;
    if (!forkOf?.address) return;
    const [kindStr, pubkey, ...rest] = forkOf.address.split(':');
    const kind = Number(kindStr);
    const identifier = rest.join(':');
    if (!Number.isFinite(kind) || !pubkey || !identifier) return;
    const relays = [...(forkOf.relay ? [forkOf.relay] : []), ...getCommunikeyRelays()];
    const loaderSub = addressLoader({ kind, pubkey, identifier, relays }).subscribe();
    const modelSub = eventStore.replaceable(kind, pubkey, identifier).subscribe((e) => {
      if (e) parentFormEvent = e;
    });
    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  const parentNaddr = $derived(
    parentFormEvent ? formEventToNaddr(parentFormEvent, forkOf?.relay ? [forkOf.relay] : []) : ''
  );
  const parentName = $derived(
    parentFormEvent?.tags.find((/** @type {string[]} */ t) => t[0] === 'name')?.[1] ||
      forkOf?.address ||
      ''
  );

  let showSendModal = $state(false);
</script>

<div class="container mx-auto max-w-3xl p-4">
  {#if isLoading}
    <div class="flex justify-center p-8">
      <span class="loading loading-lg loading-spinner"></span>
    </div>
  {:else if error}
    <div class="alert alert-error">{error}</div>
  {:else if formEvent}
    <!-- Header with actions -->
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-bold">
        {formEvent.tags.find((t) => t[0] === 'name')?.[1] || m.forms_untitled()}
      </h1>
      <div class="flex gap-2">
        {#if isOwner}
          <button class="btn gap-1 btn-ghost btn-sm" onclick={() => (showSendModal = true)}>
            <SendIcon class="h-4 w-4" />
            {m.send_form_button()}
          </button>
          <a href="/forms/{data.naddr}/edit" class="btn gap-1 btn-ghost btn-sm">
            <EditIcon class_="w-4 h-4" />
            {m.forms_edit()}
          </a>
        {/if}
        <a href="/forms/{data.naddr}/respond" class="btn btn-sm btn-primary">{m.forms_fill()}</a>
        <EventContextMenu event={formEvent} />
      </div>
    </div>

    {#if forkOf}
      <div class="mb-4 rounded-lg bg-base-200 px-4 py-2 text-sm">
        {m.form_builder_fork_badge()}
        {#if parentNaddr}
          <a class="link font-semibold" href="/forms/{parentNaddr}">{parentName}</a>
        {:else}
          <span class="font-semibold">{parentName}</span>
        {/if}
      </div>
    {/if}

    <!-- Tabs -->
    <div role="tablist" class="tabs-bordered mb-4 tabs">
      <button
        role="tab"
        class="tab"
        class:tab-active={activeTab === 'preview'}
        onclick={() => (activeTab = 'preview')}
      >
        {m.forms_preview_tab()}
      </button>
      {#if isOwner}
        <button
          role="tab"
          class="tab"
          class:tab-active={activeTab === 'responses'}
          onclick={() => (activeTab = 'responses')}
        >
          {m.forms_responses_tab()}
        </button>
      {/if}
    </div>

    <!-- Tab content -->
    {#if activeTab === 'preview'}
      <FormRenderer {formEvent} readonly />
    {:else if activeTab === 'responses' && isOwner}
      <FormResponses {formEvent} {formAddress} />
    {/if}
  {/if}
</div>

{#if showSendModal && formEvent}
  <SendFormModal {formEvent} {formAddress} onclose={() => (showSendModal = false)} />
{/if}
