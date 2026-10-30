<!--
  PeopleResults - body of the discover "Personen" tab (profile / user search).
  Query comes from the page's search box (URL-synced ?search=); results from
  usePeopleSearch(): members of the deployment's NIP-05 domain as their own
  titled group on top, then everyone else (follows first, then NIP-85 trust
  rank); scored rows badged "im Vertrauensnetz". Unscored accounts are never
  hidden. Without matching members there are no group titles.
  Cards show display name, NIP-05 (verified badge) and a clamped bio.
  With an empty query the tab lists the user's follows, or a hint.
-->

<script>
  import ProfileCard from '$lib/components/shared/ProfileCard.svelte';
  import { usePeopleSearch } from '$lib/stores/people-search.svelte.js';
  import { contactsStore } from '$lib/stores/contacts.svelte.js';
  import * as m from '$lib/paraglide/messages';
  import { getMemberDomain } from '$lib/stores/member-directory.svelte.js';
  import { useFollowedBy } from '$lib/stores/followed-by.svelte.js';
  import FollowedByLine from '$lib/components/people/FollowedByLine.svelte';
  import EducatorChips from '$lib/components/people/EducatorChips.svelte';

  /** Follows shown for an empty query — enough to be useful, not a directory. */
  const FOLLOWS_PREVIEW = 30;

  /** @type {{ query?: string }} */
  let { query = '' } = $props();

  const getSearch = usePeopleSearch(() => query);
  const search = $derived(getSearch());
  // "Gefolgt von …" for the result cards — the strongest hint between namesakes
  const getFollowedBy = useFollowedBy(() =>
    search.tooShort ? [] : search.results.map((c) => c.pubkey)
  );
  const follows = $derived(
    search.tooShort && contactsStore.isLoaded
      ? contactsStore.contacts.slice(0, FOLLOWS_PREVIEW)
      : []
  );
</script>

{#snippet grid(/** @type {import('$lib/stores/contacts.svelte.js').EnrichedContact[]} */ list)}
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {#each list as contact (contact.pubkey)}
      {@const score = search.scores.get(contact.pubkey)}
      <div
        class="flex items-center gap-2 rounded-lg bg-base-100 p-2"
        data-testid="people-result"
        data-pubkey={contact.pubkey}
      >
        <div class="min-w-0 flex-1">
          <ProfileCard pubkey={contact.pubkey} size="sm" showIcon={false} showNip05 showAbout />
          <EducatorChips pubkey={contact.pubkey} />
          <FollowedByLine followers={getFollowedBy().get(contact.pubkey) ?? []} />
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
{/snippet}

<div data-testid="people-results">
  {#if search.tooShort}
    {#if follows.length > 0}
      <h2 class="mb-4 text-center text-sm text-base-content/70">
        {m.people_search_follows_title()}
      </h2>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each follows as pubkey (pubkey)}
          <div class="rounded-lg bg-base-100 p-2" data-testid="people-result" data-pubkey={pubkey}>
            <ProfileCard {pubkey} size="sm" showIcon={false} showNip05 showAbout />
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

    {#if search.memberResults.length > 0}
      <section data-testid="people-members">
        <h2 class="mb-3 text-sm font-semibold text-base-content/70">
          {m.people_search_members_title({ domain: `@${getMemberDomain()}` })}
        </h2>
        {@render grid(search.memberResults)}
      </section>
      {#if search.otherResults.length > 0}
        <section data-testid="people-others" class="mt-8">
          <h2 class="mb-3 text-sm font-semibold text-base-content/70">
            {m.people_search_others_title()}
          </h2>
          {@render grid(search.otherResults)}
        </section>
      {/if}
    {:else if search.results.length > 0}
      {@render grid(search.otherResults)}
    {:else if !search.busy}
      <div class="flex justify-center py-12">
        <p class="text-center text-xl text-base-content/70">
          {m.people_search_no_results({ term: search.term })}
        </p>
      </div>
    {/if}
  {/if}
</div>
