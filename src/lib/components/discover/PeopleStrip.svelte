<!--
  PeopleStrip — a compact people row above the content results of the
  /discover "Alle" tab while a search is active: the first few matches of
  usePeopleSearch() (members of the deployment's NIP-05 domain first), and a
  hand-over to the full "Personen" tab. Renders nothing without matches, so
  a content-only search looks as before.
-->
<script>
  import ProfileCard from '$lib/components/shared/ProfileCard.svelte';
  import { usePeopleSearch } from '$lib/stores/people-search.svelte.js';
  import { useFollowedBy } from '$lib/stores/followed-by.svelte.js';
  import FollowedByLine from '$lib/components/people/FollowedByLine.svelte';
  import EducatorChips from '$lib/components/people/EducatorChips.svelte';
  import * as m from '$lib/paraglide/messages';

  /** Cards in the row; the people tab has the rest. */
  const STRIP_SIZE = 3;

  /** @type {{ query: string, onshowall: () => void }} */
  let { query, onshowall } = $props();

  const getSearch = usePeopleSearch(() => query);
  const search = $derived(getSearch());
  const shown = $derived(search.tooShort ? [] : search.results.slice(0, STRIP_SIZE));
  const getFollowedBy = useFollowedBy(() => shown.map((c) => c.pubkey));
</script>

{#if shown.length > 0}
  <section class="mb-8" data-testid="people-strip">
    <div class="mb-3 flex items-baseline justify-between gap-2">
      <h2 class="text-sm font-semibold text-base-content/70">{m.discover_people_strip_title()}</h2>
      <button type="button" class="btn btn-ghost btn-sm" onclick={onshowall}>
        {m.discover_people_strip_show_all()} <span aria-hidden="true">→</span>
      </button>
    </div>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each shown as contact (contact.pubkey)}
        <div
          class="rounded-lg bg-base-100 p-2"
          data-testid="people-strip-card"
          data-pubkey={contact.pubkey}
        >
          <ProfileCard pubkey={contact.pubkey} size="sm" showIcon={false} showNip05 showAbout />
          <EducatorChips pubkey={contact.pubkey} />
          <FollowedByLine followers={getFollowedBy().get(contact.pubkey) ?? []} />
        </div>
      {/each}
    </div>
  </section>
{/if}
