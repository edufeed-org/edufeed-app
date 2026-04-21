<script>
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { formTemplateLoader } from '$lib/loaders/community.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { formEventToNaddr } from '$lib/helpers/forms.js';
  import { TimelineModel } from 'applesauce-core/models';
  import { PlusIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {import('nostr-tools').NostrEvent[]} */
  let forms = $state.raw([]);
  let isLoading = $state(true);

  $effect(() => {
    if (!manager.active) {
      isLoading = false;
      return;
    }

    const pubkey = manager.active.pubkey;
    const loader = formTemplateLoader(pubkey);
    const loaderSub = loader().subscribe();

    const modelSub = eventStore
      .model(TimelineModel, { kinds: [30168], authors: [pubkey] })
      .subscribe((events) => {
        forms = events || [];
        isLoading = false;
      });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });
</script>

<div class="container mx-auto max-w-3xl p-4">
  <div class="mb-6 flex items-center justify-between">
    <h1 class="text-2xl font-bold">{m.forms_my_forms()}</h1>
    <a href="/forms/new" class="btn btn-sm btn-primary">
      <PlusIcon class_="w-4 h-4" />
      {m.forms_new_form()}
    </a>
  </div>

  {#if !manager.active}
    <div class="alert alert-warning">{m.forms_login_required()}</div>
  {:else if isLoading}
    <div class="flex justify-center p-8">
      <span class="loading loading-lg loading-spinner"></span>
    </div>
  {:else if forms.length === 0}
    <div class="py-12 text-center text-base-content/50">
      <p class="mb-4">{m.forms_empty()}</p>
      <a href="/forms/new" class="btn btn-primary">{m.forms_create_first()}</a>
    </div>
  {:else}
    <div class="space-y-2">
      {#each forms as form (form.id)}
        {@const name = form.tags.find((t) => t[0] === 'name')?.[1] || 'Untitled Form'}
        {@const desc = form.tags.find((t) => t[0] === 'description')?.[1] || ''}
        {@const fieldCount = form.tags.filter((t) => t[0] === 'field').length}
        {@const relays = getCommunikeyRelays().slice(0, 2)}
        <a
          href="/forms/{formEventToNaddr(form, relays)}"
          class="block rounded-lg border border-base-content/10 p-4 transition-colors hover:bg-base-200/50"
        >
          <div class="font-semibold">{name}</div>
          {#if desc}
            <div class="mt-1 text-sm text-base-content/60">{desc}</div>
          {/if}
          <div class="mt-2 text-xs text-base-content/40">
            {fieldCount} field{fieldCount !== 1 ? 's' : ''}
            {#if form.tags.some((t) => t[0] === 'public')}
              · {m.forms_public()}
            {:else}
              · {m.forms_encrypted()}
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
