<!--
  ListItemsFilter — search field and type chips above the items of a list
  (issue a0838dc9). The view owns the rows and filters them with
  filterListItems(); this only edits the query and the type (bindable).
  Type chips appear only when the list mixes at least two types.
-->
<script>
  import { SearchIcon } from '$lib/components/icons';
  import { feedTypeLabel } from '$lib/helpers/feed-type-label.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ types: string[], query?: string, type?: string }} */
  let { types, query = $bindable(''), type = $bindable('') } = $props();
</script>

<div class="mb-3 space-y-2" data-testid="list-item-filter">
  <label class="input input-sm flex w-full items-center gap-2">
    <SearchIcon class_="w-4 h-4 opacity-60" />
    <input
      type="search"
      class="grow"
      placeholder={m.list_detail_search_placeholder()}
      bind:value={query}
    />
  </label>
  {#if types.length > 1}
    <div class="flex flex-wrap gap-1">
      <button
        type="button"
        class="btn btn-sm {type === '' ? 'btn-primary' : 'btn-ghost'}"
        onclick={() => (type = '')}
      >
        {m.list_detail_filter_all()}
      </button>
      {#each types as key (key)}
        <button
          type="button"
          class="btn btn-sm {type === key ? 'btn-primary' : 'btn-ghost'}"
          onclick={() => (type = type === key ? '' : key)}
        >
          {feedTypeLabel(key) || key}
        </button>
      {/each}
    </div>
  {/if}
</div>
