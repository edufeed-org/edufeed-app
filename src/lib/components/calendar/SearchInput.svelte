<!--
  SearchInput Component
  Generic, controlled search input with optional debounce, clear button, and
  Enter-to-submit. The component does not own any store state — the parent
  passes `value`, receives debounced `onChange(value)`, and optionally an
  `onSubmit(value)` triggered on Enter (with the current debounce flushed).
-->

<script>
  import { SearchIcon, CloseIcon } from '../icons';
  import * as m from '$lib/paraglide/messages';

  /** @typedef {Object} Props
   *  @property {string} [value]
   *  @property {string} [placeholder]
   *  @property {string} [ariaLabel]
   *  @property {string} [clearAriaLabel]
   *  @property {number} [debounceMs]   0 = fire onChange synchronously
   *  @property {(value: string) => void} [onChange]
   *  @property {(value: string) => void} [onSubmit]   Fired on Enter
   */

  /** @type {Props} */
  let {
    value = '',
    placeholder = m.calendar_search_placeholder(),
    ariaLabel = m.calendar_search_aria(),
    clearAriaLabel = m.calendar_search_clear_aria(),
    debounceMs = 0,
    onChange = (/** @type {string} */ _v) => {},
    onSubmit
  } = $props();

  // Internal mirror so typing stays responsive even when `value` is owned by
  // the parent. Writable $derived: reassigning during input overrides until
  // the parent prop changes again.
  let internalValue = $derived(value);

  /** @type {ReturnType<typeof setTimeout> | null} */
  let debounceTimer = null;

  function flushDebounce() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function publish(/** @type {string} */ next) {
    flushDebounce();
    if (debounceMs > 0) {
      debounceTimer = setTimeout(() => onChange(next), debounceMs);
    } else {
      onChange(next);
    }
  }

  function handleInput(/** @type {Event} */ event) {
    const target = /** @type {HTMLInputElement} */ (event.target);
    internalValue = target.value;
    publish(internalValue);
  }

  function handleKeydown(/** @type {KeyboardEvent} */ event) {
    if (event.key === 'Enter' && onSubmit) {
      event.preventDefault();
      // Flush a pending debounce so onChange has the latest value before the
      // parent reads it on the back of onSubmit.
      flushDebounce();
      onChange(internalValue);
      onSubmit(internalValue);
    }
  }

  function clearSearch() {
    internalValue = '';
    flushDebounce();
    onChange('');
  }

  let hasQuery = $derived(internalValue.trim().length > 0);
</script>

<div
  class="input-bordered input join input-sm flex items-center gap-2"
  data-testid="calendar-search-input"
>
  <SearchIcon class_="h-4 w-4 text-base-content/60" />
  <input
    type="search"
    class="grow border-0 bg-transparent p-0 outline-none focus:outline-none"
    {placeholder}
    value={internalValue}
    oninput={handleInput}
    onkeydown={handleKeydown}
    aria-label={ariaLabel}
  />
  {#if hasQuery}
    <button
      type="button"
      class="btn btn-circle btn-ghost btn-xs"
      onclick={clearSearch}
      aria-label={clearAriaLabel}
      title={clearAriaLabel}
    >
      <CloseIcon class_="h-3.5 w-3.5" />
    </button>
  {/if}
</div>
