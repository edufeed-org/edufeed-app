<!--
  PeopleResults - body of the discover "Personen" tab (profile / user search).
  Query comes from the page's search box (URL-synced ?search=); results from
  usePeopleSearch(): follows first, then everyone else by NIP-85 trust rank,
  scored rows badged "im Vertrauensnetz". Unscored accounts are never hidden.
  With an empty query the tab lists the user's follows, or a hint.
-->

<script>
  import ProfileCard from '$lib/components/shared/ProfileCard.svelte';
  import { usePeopleSearch } from '$lib/stores/people-search.svelte.js';
  import { contactsStore } from '$lib/stores/contacts.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** Follows shown for an empty query — enough to be useful, not a directory. */
  const FOLLOWS_PREVIEW = 30;

  /** @type {{ query?: string }} */
  let { query = '' } = $props();

  const getSearch = usePeopleSearch(() => query);
  const search = $derived(getSearch());
  const follows = $derived(
    search.tooShort && contactsStore.isLoaded
      ? contactsStore.contacts.slice(0, FOLLOWS_PREVIEW)
      : []
  );
</script>

<div data-testid="people-results">
  {#if search.tooShort}
    {#if follows.length > 0}
      <h2 class="mb-4 text-center text-sm text-base-content/70">
        {m.people_search_follows_title()}
      </h2>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each follows as pubkey (pubkey)}
          <div class="rounded-lg bg-base-100 p-2" data-testid="people-result" data-pubkey={pubkey}>
            <ProfileCard {pubkey} size="sm" showIcon={false} />
          </div>
        {/each}
      </div>
    {:else}
      <div class="flex justify-center py-12">
        <p class="text-center text-base-content/70">{m.people_search_hint()}</p>
      </div>
    {/if}
  {:else}
    {#if search.busy}
      <div class="mb-4 flex items-center justify-center gap-2 text-sm text-base-content/60">
        <span class="loading loading-sm loading-spinner"></span>
        {m.people_search_searching()}
      </div>
    {:else if search.results.length > 0}
      <div class="mb-4 text-center text-sm text-base-content/70">
        {m.discover_results_count({ count: search.results.length })}
      </div>
    {/if}

    {#if search.results.length > 0}
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each search.results as contact (contact.pubkey)}
          {@const score = search.scores.get(contact.pubkey)}
          <div
            class="flex items-center gap-2 rounded-lg bg-base-100 p-2"
            data-testid="people-result"
            data-pubkey={contact.pubkey}
          >
            <div class="min-w-0 flex-1">
              <ProfileCard pubkey={contact.pubkey} size="sm" showIcon={false} />
            </div>
            {#if score}
              <span
                data-testid="people-wot-badge"
                class="badge shrink-0 badge-ghost badge-sm"
                title={m.contact_search_wot_title({
                  hops: score.hops ?? '–',
                  followers: score.followers ?? '–'
                })}
              >
                {m.contact_search_wot_known()}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {:else if !search.busy}
      <div class="flex justify-center py-12">
        <p class="text-center text-xl text-base-content/70">
          {m.people_search_no_results({ term: search.term })}
        </p>
      </div>
    {/if}
  {/if}
</div>
