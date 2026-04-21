<!--
  DashboardMyStuff — Container with sub-tabs for "Your Content" and "Lists".
-->
<script>
  import { page } from '$app/stores';
  import DashboardYourContent from './DashboardYourContent.svelte';
  import DashboardLists from './DashboardLists.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ pubkey: string }} */
  let { pubkey } = $props();

  let activeTab = $derived($page.url.searchParams.get('tab') || 'content');
</script>

<section>
  <!-- Sub-tab pills -->
  <div class="mb-4 flex gap-2">
    <a
      href="?view=my-stuff&tab=content"
      class="btn btn-sm {activeTab === 'content' ? 'btn-primary' : 'btn-ghost'}"
    >
      {m.dashboard_my_stuff_tab_content()}
    </a>
    <a
      href="?view=my-stuff&tab=lists"
      class="btn btn-sm {activeTab === 'lists' ? 'btn-primary' : 'btn-ghost'}"
    >
      {m.dashboard_my_stuff_tab_lists()}
    </a>
  </div>

  {#if activeTab === 'lists'}
    <DashboardLists {pubkey} />
  {:else}
    <DashboardYourContent {pubkey} />
  {/if}
</section>
