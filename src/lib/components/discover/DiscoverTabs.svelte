<!--
  DiscoverTabs — the content type tab bar of /discover. Only the types a
  deployment enables are passed in; a single tab needs no bar.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /** @type {{ tabs: string[], active: string, onchange: (type: string) => void }} */
  let { tabs, active, onchange } = $props();

  /** Static label table — never index the Paraglide namespace by a runtime key. */
  const TAB_LABELS = {
    all: m.discover_tab_all,
    events: m.discover_tab_events,
    learning: m.discover_tab_learning,
    articles: m.discover_tab_articles,
    boards: m.discover_tab_boards,
    communities: m.discover_tab_communities,
    people: m.discover_tab_people
  };
</script>

{#if tabs.length > 1}
  <div class="border-b border-base-300">
    <div class="container mx-auto px-4">
      <div class="tabs-boxed tabs justify-center bg-transparent py-4">
        {#each tabs as tab (tab)}
          <button
            class="tab {active === tab ? 'tab-active' : ''}"
            data-testid="tab-{tab}"
            onclick={() => onchange(tab)}
          >
            {TAB_LABELS[/** @type {keyof typeof TAB_LABELS} */ (tab)]()}
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}
