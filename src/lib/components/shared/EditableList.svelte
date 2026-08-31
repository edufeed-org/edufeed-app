<!--
  EditableList Component
  Reusable component for managing a list of items (relays, servers, etc.)
-->

<script>
  import * as m from '$lib/paraglide/messages';

  let {
    items = $bindable([]),
    label = m.editable_list_default_label(),
    placeholder = m.editable_list_default_placeholder(),
    buttonText = m.editable_list_default_button(),
    itemType = m.editable_list_default_item_type(),
    validator = null,
    normalize = null,
    minItems = 0,
    helpText = ''
  } = $props();

  let inputValue = $state('');
  let error = $state('');

  /**
   * Add a new item to the list
   */
  function addItem() {
    const rawValue = inputValue.trim();

    if (!rawValue) {
      error = m.editable_list_error_empty({ itemType });
      return;
    }

    // Normalize before the duplicate check — otherwise a bare "relay.example.org"
    // slips past an entry already stored as "wss://relay.example.org". A
    // normalizer that cannot handle the input returns it unchanged, leaving the
    // validator to produce the error message.
    const trimmedValue = normalize ? normalize(rawValue) : rawValue;

    // Check for duplicates
    if (items.includes(trimmedValue)) {
      error = m.editable_list_error_duplicate({ itemType });
      return;
    }

    // Run custom validator if provided
    if (validator) {
      const validationError = validator(trimmedValue);
      if (validationError) {
        error = validationError;
        return;
      }
    }

    // Add item
    items = [...items, trimmedValue];
    inputValue = '';
    error = '';
  }

  /**
   * Remove an item from the list
   * @param {number} index
   */
  function removeItem(index) {
    // Check minimum items constraint
    if (items.length <= minItems) {
      error = m.editable_list_error_min_items({
        count: minItems,
        itemType,
        plural: minItems !== 1 ? 's' : ''
      });
      return;
    }

    items = items.filter((_, i) => i !== index);
    error = '';
  }

  /**
   * Handle Enter key in input
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
  }
</script>

<div class="form-control">
  <label class="label" for="editable-list-input">
    <span class="label-text">{label}</span>
    {#if helpText}
      <span class="label-text-alt">{helpText}</span>
    {/if}
  </label>

  <!-- Input row -->
  <div class="mb-3 flex gap-2">
    <input
      id="editable-list-input"
      type="text"
      bind:value={inputValue}
      {placeholder}
      onkeydown={handleKeydown}
      class="input-bordered input flex-1"
      class:input-error={error}
    />
    <button type="button" class="btn btn-primary" onclick={addItem}>
      {buttonText}
    </button>
  </div>

  <!-- Error message -->
  {#if error}
    <div class="label" aria-live="polite">
      <span class="label-text-alt text-error">{error}</span>
    </div>
  {/if}

  <!-- Items list -->
  {#if items.length > 0}
    <div class="mt-2 space-y-2">
      {#each items as item, index (index)}
        <div class="flex items-center gap-2 rounded-lg bg-base-200 p-3">
          <span class="flex-1 text-sm break-all">{item}</span>
          <button
            type="button"
            class="btn btn-circle btn-ghost btn-sm"
            onclick={() => removeItem(index)}
            disabled={items.length <= minItems}
            aria-label={m.editable_list_remove_aria({ itemType })}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <div class="text-sm text-base-content/60 italic">
      {m.editable_list_empty_state({ itemType, plural: 's' })}
    </div>
  {/if}
</div>
