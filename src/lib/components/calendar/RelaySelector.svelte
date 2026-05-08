<!--
  RelaySelector Component
  Flat panel for selecting Nostr relays to filter calendar events.
  Auto-applies changes on toggle/add/remove — no explicit Apply button.
  Designed to be embedded inside AdvancedFiltersDropdown (desktop) or
  the mobile drawer's "Advanced" section.
-->

<script>
  import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { CloseIcon, PlusIcon, RelayIcon } from '../icons';
  import * as m from '$lib/paraglide/messages';

  /** @typedef {Object} Props
   *  @property {(relays: string[]) => void} [onApplyFilters]
   */

  /** @type {Props} */
  let { onApplyFilters = (/** @type {string[]} */ _r) => {} } = $props();

  let customRelayInput = $state('');
  let customRelays = $state(/** @type {string[]} */ ([]));
  let error = $state(/** @type {string | null} */ (null));

  /** @type {string[]} */
  const defaultRelays = Array.from(
    new Set([...(runtimeConfig.appRelays?.calendar || []), ...(runtimeConfig.fallbackRelays || [])])
  );

  let selectedRelays = $derived(calendarFilters.selectedRelays);

  function publish(/** @type {string[]} */ next) {
    calendarFilters.setSelectedRelays(next);
    onApplyFilters(next);
  }

  function toggleRelay(/** @type {string} */ relay) {
    const next = selectedRelays.includes(relay)
      ? selectedRelays.filter((r) => r !== relay)
      : [...selectedRelays, relay];
    publish(next);
  }

  function isValidRelayUrl(/** @type {string} */ url) {
    const trimmed = url.trim();
    return trimmed.startsWith('wss://') || trimmed.startsWith('ws://');
  }

  function addCustomRelay() {
    error = null;
    const trimmed = customRelayInput.trim();
    if (!trimmed) return;

    if (!isValidRelayUrl(trimmed)) {
      error = m.relay_filter_url_invalid();
      return;
    }

    // Auto-upgrade ws:// to wss://
    const relayUrl = trimmed.startsWith('ws://') ? trimmed.replace('ws://', 'wss://') : trimmed;

    if (defaultRelays.includes(relayUrl) || customRelays.includes(relayUrl)) {
      error = m.relay_filter_already_exists();
      return;
    }

    customRelays = [...customRelays, relayUrl];
    customRelayInput = '';
    publish([...selectedRelays, relayUrl]);
  }

  function removeCustomRelay(/** @type {string} */ relay) {
    customRelays = customRelays.filter((r) => r !== relay);
    publish(selectedRelays.filter((r) => r !== relay));
  }

  function clearAllRelays() {
    customRelays = [];
    customRelayInput = '';
    error = null;
    publish([]);
  }
</script>

<div class="space-y-3" data-testid="relay-selector-panel">
  <!-- Popular Relays -->
  <div>
    <h4 class="mb-2 text-xs font-medium text-base-content/60 uppercase">
      {m.relay_filter_popular()}
    </h4>
    <div class="space-y-1">
      {#each defaultRelays as relay (relay)}
        <label class="flex cursor-pointer items-center gap-2 rounded p-1.5 hover:bg-base-200">
          <input
            type="checkbox"
            class="checkbox checkbox-xs checkbox-primary"
            checked={selectedRelays.includes(relay)}
            onchange={() => toggleRelay(relay)}
          />
          <RelayIcon class_="h-3.5 w-3.5 text-base-content/50" />
          <span class="flex-1 truncate text-sm">{relay.replace('wss://', '')}</span>
        </label>
      {/each}
    </div>
  </div>

  <!-- Custom Relay Input -->
  <div>
    <h4 class="mb-2 text-xs font-medium text-base-content/60 uppercase">
      {m.relay_filter_custom()}
    </h4>
    <div class="flex gap-1">
      <input
        type="text"
        class="input-bordered input input-xs flex-1"
        placeholder={m.relay_filter_custom_placeholder()}
        bind:value={customRelayInput}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addCustomRelay();
          }
        }}
      />
      <button
        type="button"
        class="btn gap-1 btn-xs btn-primary"
        onclick={addCustomRelay}
        disabled={!customRelayInput.trim()}
      >
        <PlusIcon class_="h-3 w-3" />
        {m.relay_filter_add()}
      </button>
    </div>
    {#if error}
      <p class="mt-1 text-xs text-warning">{error}</p>
    {/if}
  </div>

  <!-- Custom Relays List -->
  {#if customRelays.length > 0}
    <div>
      <h4 class="mb-2 text-xs font-medium text-base-content/60 uppercase">
        {m.relay_filter_custom_relays()}
      </h4>
      <div class="space-y-1">
        {#each customRelays as relay (relay)}
          <div class="flex items-center gap-2 rounded bg-base-200 px-2 py-1 text-sm">
            <label class="flex flex-1 cursor-pointer items-center gap-2 truncate">
              <input
                type="checkbox"
                class="checkbox checkbox-xs checkbox-primary"
                checked={selectedRelays.includes(relay)}
                onchange={() => toggleRelay(relay)}
              />
              <RelayIcon class_="h-3.5 w-3.5 text-base-content/50" />
              <span class="truncate">{relay.replace('wss://', '')}</span>
            </label>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              onclick={() => removeCustomRelay(relay)}
              title={m.relay_filter_remove()}
              aria-label={m.relay_filter_remove()}
            >
              <CloseIcon class_="h-3 w-3" />
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if selectedRelays.length > 0}
    <button
      type="button"
      class="btn w-full btn-ghost btn-xs"
      onclick={clearAllRelays}
      data-testid="relay-selector-clear"
    >
      {m.relay_filter_clear_all()} ({selectedRelays.length})
    </button>
  {/if}
</div>
