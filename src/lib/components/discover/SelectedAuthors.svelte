<!--
  SelectedAuthors — profile cards of the authors picked in the /discover
  author filter, above the results. Picking a person who has published
  nothing (yet) must still show who they are, with a way to their profile.
-->
<script>
  import ProfileCard from '$lib/components/shared/ProfileCard.svelte';

  /** @type {{ pubkeys: string[] }} */
  let { pubkeys } = $props();
</script>

{#if pubkeys.length > 0}
  <section
    class="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    data-testid="selected-authors"
  >
    {#each pubkeys as pubkey (pubkey)}
      <div class="rounded-lg bg-base-100 p-2" data-testid="selected-author" data-pubkey={pubkey}>
        <ProfileCard {pubkey} size="sm" showIcon={false} showNip05 showAbout />
      </div>
    {/each}
  </section>
{/if}
