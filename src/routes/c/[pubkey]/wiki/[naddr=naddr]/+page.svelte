<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import WikiView from '$lib/components/wiki/WikiView.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ data: any }} */
  let { data } = $props();

  const communityPubkey = $derived($page.data.pubkey);

  function goBack() {
    goto(resolve(`/c/${$page.params.pubkey}?view=wikis`));
  }
</script>

<div class="flex-1 overflow-auto pb-16 transition-all duration-300 lg:ml-[304px] lg:pb-0">
  <div class="mx-auto max-w-4xl p-4">
    <button onclick={goBack} class="btn mb-4 gap-1 btn-ghost btn-sm">
      <ChevronLeftIcon class_="w-4 h-4" />
      {m.common_back()}
    </button>

    {#if data.event}
      <WikiView event={data.event} {communityPubkey} />
    {/if}
  </div>
</div>
