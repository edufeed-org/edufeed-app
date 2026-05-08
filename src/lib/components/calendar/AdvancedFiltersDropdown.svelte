<!--
  AdvancedFiltersDropdown Component
  Hosts power-user filters (relay picker + custom relay input) behind an
  "Advanced ▾" dropdown trigger. Intentionally out of the primary filter
  flow so the default experience stays focused on Search / Tags / People.
-->

<script>
  import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';
  import RelaySelector from './RelaySelector.svelte';
  import { SettingsIcon } from '../icons';
  import * as m from '$lib/paraglide/messages';

  /** @typedef {Object} Props
   *  @property {(relays: string[]) => void} [onRelayFilterChange]
   */

  /** @type {Props} */
  let { onRelayFilterChange = (/** @type {string[]} */ _r) => {} } = $props();

  let activeCount = $derived(calendarFilters.selectedRelays.length);
</script>

<div class="dropdown dropdown-end">
  <button
    type="button"
    tabindex="0"
    class="btn gap-1 btn-outline btn-sm"
    data-filter-trigger
    data-testid="advanced-filters-trigger"
  >
    <SettingsIcon class_="h-4 w-4" />
    <span>{m.calendar_advanced_title()}</span>
    {#if activeCount > 0}
      <span class="badge badge-sm badge-primary" data-filter-count>{activeCount}</span>
    {/if}
    <span aria-hidden="true">▾</span>
  </button>

  <div
    tabindex="-1"
    class="dropdown-content z-30 mt-1 w-80 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg"
    data-testid="advanced-filters-panel"
  >
    <h3 class="mb-2 text-sm font-semibold">{m.calendar_advanced_relays_heading()}</h3>
    <RelaySelector onApplyFilters={onRelayFilterChange} />
  </div>
</div>
