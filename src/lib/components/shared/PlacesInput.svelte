<!--
  PlacesInput Component
  Multi-entry place picker with geocoding autocomplete. Selected places are
  rendered as removable chips; suggestions carry coordinates from the
  geocoder, free-text entries (Enter) are stored name-only.
-->

<script>
  import { autocompleteAddress } from '$lib/helpers/geocoding.js';
  import { CloseIcon, LocationIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {import('$lib/helpers/educational/educatorProfile.js').ProfilePlace} ProfilePlace
   */

  /** @type {{ places?: ProfilePlace[], label?: string, helpText?: string, onchange?: (places: ProfilePlace[]) => void }} */
  let {
    places = $bindable([]),
    label = m.places_input_label(),
    helpText = '',
    onchange = () => {}
  } = $props();

  let query = $state('');
  let suggestions = $state(
    /** @type {Array<{formatted: string, lat: number, lng: number}>} */ ([])
  );
  let showSuggestions = $state(false);
  let isLoading = $state(false);
  let debounceTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);

  /** @param {Event} e */
  function handleInput(e) {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const value = input.value;

    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (value.length < 3) {
      showSuggestions = false;
      suggestions = [];
      return;
    }

    isLoading = true;
    debounceTimer = setTimeout(async () => {
      try {
        const results = await autocompleteAddress(value);
        suggestions = results;
        showSuggestions = results.length > 0;
      } catch (error) {
        console.error('Error fetching place suggestions:', error);
        suggestions = [];
        showSuggestions = false;
      } finally {
        isLoading = false;
      }
    }, 400);
  }

  /** @param {ProfilePlace} place */
  function addPlace(place) {
    if (!place.name.trim()) return;
    if (places.some((p) => p.name === place.name)) {
      query = '';
      showSuggestions = false;
      return;
    }
    places = [...places, place];
    query = '';
    suggestions = [];
    showSuggestions = false;
    onchange(places);
  }

  /** @param {number} index */
  function removePlace(index) {
    places = places.filter((_, i) => i !== index);
    onchange(places);
  }

  /** @param {KeyboardEvent} e */
  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Prefer the first suggestion; fall back to free text (name only)
      if (showSuggestions && suggestions.length > 0) {
        const s = suggestions[0];
        addPlace({ name: s.formatted, lat: s.lat, lng: s.lng });
      } else if (query.trim()) {
        addPlace({ name: query.trim() });
      }
    }
  }

  function handleBlur() {
    setTimeout(() => {
      showSuggestions = false;
    }, 200);
  }
</script>

<div class="form-control w-full">
  {#if label}
    <div class="label">
      <span class="label-text font-medium">{label}</span>
    </div>
  {/if}

  {#if places.length > 0}
    <div class="mb-2 flex flex-wrap gap-2" data-testid="places-chips">
      {#each places as place, index (place.name)}
        <span class="badge gap-1 badge-outline">
          <LocationIcon class_="w-3 h-3" />
          {place.name}
          <button
            type="button"
            class="ml-1"
            onclick={() => removePlace(index)}
            aria-label={m.places_input_remove_aria({ name: place.name })}
          >
            <CloseIcon class_="w-3 h-3" />
          </button>
        </span>
      {/each}
    </div>
  {/if}

  <div class="relative">
    <input
      type="text"
      class="input-bordered input w-full"
      bind:value={query}
      oninput={handleInput}
      onkeydown={handleKeydown}
      onblur={handleBlur}
      placeholder={m.places_input_placeholder()}
      autocomplete="off"
      data-testid="places-input"
    />

    {#if showSuggestions && suggestions.length > 0}
      <div
        class="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-base-300 bg-base-100 shadow-lg"
      >
        {#each suggestions as suggestion (suggestion.formatted)}
          <button
            type="button"
            class="w-full px-4 py-2 text-left text-sm transition-colors hover:bg-base-200"
            onclick={() =>
              addPlace({ name: suggestion.formatted, lat: suggestion.lat, lng: suggestion.lng })}
          >
            {suggestion.formatted}
          </button>
        {/each}
      </div>
    {/if}

    {#if isLoading}
      <div class="mt-1 text-xs text-base-content/60">{m.location_input_loading()}</div>
    {/if}
  </div>

  {#if helpText}
    <p class="mt-1 text-xs text-base-content/60">{helpText}</p>
  {/if}
</div>
