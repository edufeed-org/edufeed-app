<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { buildUserResponseFilter } from '$lib/helpers/forms.js';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { timedPool } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import MembershipApplicationForm from './MembershipApplicationForm.svelte';

  const cfg = $derived(runtimeConfig.membership);
  const enabled = $derived(cfg?.enabled === true);
  const formAddress = $derived(cfg?.formAddress || '');

  /** @type {{ created_at: number, tags: string[][] } | null} */
  let existingResponse = $state(null);
  let showForm = $state(false);

  $effect(() => {
    if (!enabled || !manager.active || !formAddress) return;
    const filter = buildUserResponseFilter(formAddress, manager.active.pubkey);
    const relays = getCommunikeyRelays();

    const loaderSub = createTimelineLoader(timedPool, relays, filter, {
      eventStore,
      limit: 1
    })().subscribe();

    const modelSub = eventStore.timeline(filter).subscribe((events) => {
      existingResponse = events?.[0] || null;
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });
</script>

{#if enabled}
  <div class="card bg-base-200 shadow-xl">
    <div class="card-body">
      <h2 class="mb-2 card-title text-2xl">
        {m.auth_signup_modal_membership_title()}
      </h2>
      <p class="mb-4 text-base-content/70">
        {m.auth_signup_modal_membership_help()}
      </p>

      {#if existingResponse}
        <div class="alert alert-info">
          <span>
            {m.membership_already_applied({
              date: new Date(existingResponse.created_at * 1000).toLocaleDateString()
            })}
          </span>
        </div>
        <div class="mt-4 card-actions">
          <button class="btn btn-ghost" onclick={() => (showForm = !showForm)}>
            {m.membership_already_applied_update()}
          </button>
        </div>
      {:else}
        <div class="card-actions">
          <button class="btn btn-primary" onclick={() => (showForm = !showForm)}>
            {m.auth_signup_modal_membership_title()}
          </button>
        </div>
      {/if}

      {#if showForm}
        <div class="mt-6 border-t border-base-300 pt-4">
          <MembershipApplicationForm onsubmitted={() => (showForm = false)} showHeader={false} />
        </div>
      {/if}
    </div>
  </div>
{/if}
