<!--
  European/German date input with a popup calendar.

  Native `<input type="date">` renders in the browser's locale, which can show
  US `MM/DD/YYYY`. This pairs a text field masked to German `DD.MM.YYYY` with a
  Cally (`<calendar-date>`) popup, while binding an ISO `YYYY-MM-DD` value, so
  the stored/serialized value stays machine-readable regardless of the user's
  browser locale. Cally's labels/first-day-of-week follow the active UI locale.

  `value` (bindable) is the ISO string; '' means empty or not-yet-valid.
-->
<script>
  import { onMount } from 'svelte';
  import { isoToGermanDate, germanDateToIso, activeDateLocale } from '$lib/helpers/dates.js';

  let {
    value = $bindable(''),
    id = undefined,
    placeholder = 'TT.MM.JJJJ',
    class: klass = 'input-bordered input w-full',
    ...rest
  } = $props();

  // Cally registers custom elements and touches `customElements`/`window`, so it
  // must load client-side only (never during SSR).
  let ready = $state(false);
  onMount(async () => {
    await import('cally');
    ready = true;
  });

  let open = $state(false);
  const locale = activeDateLocale();

  // Text shown in the field (German form). Seeded from the incoming ISO value.
  let display = $state(isoToGermanDate(value));

  // Reflect external value changes (edit-mode prefill, metadata auto-fill) into
  // the text field — but never while the user is mid-typing a value that still
  // parses to the same ISO, so we don't clobber partial input.
  $effect(() => {
    if (germanDateToIso(display) !== value) {
      display = isoToGermanDate(value);
    }
  });

  /** @param {Event & { currentTarget: HTMLInputElement }} e */
  function handleInput(e) {
    display = e.currentTarget.value;
    value = germanDateToIso(display);
  }

  /** @param {Event} e */
  function handleCalendarChange(e) {
    const picked = /** @type {{ value?: string }} */ (e.target)?.value ?? '';
    value = picked;
    display = isoToGermanDate(picked);
    open = false;
  }

  // Cally dispatches a non-bubbling `change` event, which Svelte's delegated
  // event handling never sees. Attach a direct listener via an action instead.
  /** @param {HTMLElement} node */
  function callyChange(node) {
    node.addEventListener('change', handleCalendarChange);
    return {
      destroy() {
        node.removeEventListener('change', handleCalendarChange);
      }
    };
  }

  /** @param {MouseEvent} e */
  function handleWindowClick(e) {
    if (!root) return;
    if (e.target instanceof Node && !root.contains(e.target)) open = false;
  }

  /** @type {HTMLDivElement | undefined} */
  let root = $state();
</script>

<svelte:window onclick={handleWindowClick} />

<div class="relative" bind:this={root}>
  <div class="join w-full">
    <input
      {id}
      type="text"
      inputmode="numeric"
      autocomplete="off"
      {placeholder}
      class="{klass} join-item"
      value={display}
      oninput={handleInput}
      {...rest}
    />
    <button
      type="button"
      class="btn join-item btn-outline"
      aria-label="Kalender öffnen"
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={!ready}
      onclick={() => (open = !open)}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="size-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    </button>
  </div>

  {#if open && ready}
    <div class="absolute z-50 mt-1" role="dialog">
      <calendar-date
        class="cally rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
        {value}
        {locale}
        use:callyChange
      >
        <span slot="previous" aria-label="Vorheriger Monat">
          <svg class="size-4 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
            ><path d="M15.75 19.5 8.25 12l7.5-7.5" /></svg
          >
        </span>
        <span slot="next" aria-label="Nächster Monat">
          <svg class="size-4 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
            ><path d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg
          >
        </span>
        <calendar-month></calendar-month>
      </calendar-date>
    </div>
  {/if}
</div>
