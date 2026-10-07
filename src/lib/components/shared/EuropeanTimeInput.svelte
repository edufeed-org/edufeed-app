<!--
  European/German 24-hour time input with a popup slot list.

  Native `<input type="time">` renders in the browser's locale, which can show
  a 12-hour clock ("01:00 PM"). This is a text field masked to 24-hour `HH:MM`
  binding the same `HH:MM` string a native time input would, so callers don't
  change. Lenient typing (9:30, 9.30, 930, bare 13) normalizes on blur.

  Beside it, a clock button opens a listbox of 15-minute slots (00:00–23:45),
  mirroring EuropeanDateInput's calendar popup: it opens on the current (or
  nearest) slot, arrow keys / Home / End move, Enter or a click selects,
  Escape or a click outside closes. Typing stays the primary input.

  `value` (bindable) is the `HH:MM` string; '' means empty or not-yet-valid.
-->
<script>
  import { tick } from 'svelte';
  import { parseTimeInput } from '$lib/helpers/dates.js';
  import { ClockIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  let {
    value = $bindable(''),
    id = undefined,
    placeholder = 'HH:MM',
    class: klass = 'input-bordered input w-full',
    ...rest
  } = $props();

  const uid = $props.id();
  const listboxId = `${uid}-times`;
  const STEP = 15;

  /** @param {number} minutes */
  function hhmm(minutes) {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  const SLOTS = Array.from({ length: (24 * 60) / STEP }, (_, i) => hhmm(i * STEP));

  /**
   * Index of the slot nearest to an `HH:MM` value; without one, nearest to now.
   * @param {string} time
   */
  function nearestSlot(time) {
    const match = /^(\d{2}):(\d{2})$/.exec(time);
    const now = new Date();
    const minutes = match
      ? Number(match[1]) * 60 + Number(match[2])
      : now.getHours() * 60 + now.getMinutes();
    return Math.min(SLOTS.length - 1, Math.round(minutes / STEP));
  }

  // Text shown in the field. Seeded from the incoming value.
  let display = $state(value);

  // Reflect external value changes (edit-mode prefill) into the text field —
  // but never while the user is mid-typing a value that still parses to the
  // same time, so we don't clobber partial input.
  $effect(() => {
    if (parseTimeInput(display) !== value) {
      display = value;
    }
  });

  // Flag unparseable text on blur (not per keystroke) so partial input
  // doesn't flash red while typing, mirroring EuropeanDateInput.
  let invalid = $state(false);

  let open = $state(false);
  // Keyboard cursor inside the open list (aria-activedescendant).
  let active = $state(0);

  /** @type {HTMLDivElement | undefined} */
  let root = $state();
  /** @type {HTMLUListElement | undefined} */
  let listbox = $state();
  /** @type {HTMLButtonElement | undefined} */
  let button = $state();

  /** @param {Event & { currentTarget: HTMLInputElement }} e */
  function handleInput(e) {
    display = e.currentTarget.value;
    value = parseTimeInput(display);
    if (value || !display.trim()) invalid = false;
  }

  function handleBlur() {
    if (value) {
      // Normalize lenient input (9.30, 930) to HH:MM.
      display = value;
      invalid = false;
    } else {
      invalid = display.trim() !== '';
    }
  }

  /** Keep the active option visible without scrolling the page around it. */
  function revealActive() {
    const option = listbox?.children[active];
    if (!listbox || !(option instanceof HTMLElement)) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < listbox.scrollTop || bottom > listbox.scrollTop + listbox.clientHeight) {
      listbox.scrollTop = top - (listbox.clientHeight - option.offsetHeight) / 2;
    }
  }

  async function openList() {
    active = nearestSlot(value);
    open = true;
    await tick();
    listbox?.focus();
    revealActive();
  }

  function closeList({ refocus = false } = {}) {
    open = false;
    if (refocus) button?.focus();
  }

  /** @param {number} index */
  function choose(index) {
    value = SLOTS[index];
    display = value;
    invalid = false;
    closeList({ refocus: true });
  }

  /** @param {number} index */
  function optionId(index) {
    return `${listboxId}-${index}`;
  }

  /** @param {KeyboardEvent} e */
  function handleListKeydown(e) {
    const last = SLOTS.length - 1;
    /** @type {Record<string, number>} */
    const moves = {
      ArrowDown: Math.min(last, active + 1),
      ArrowUp: Math.max(0, active - 1),
      PageDown: Math.min(last, active + 4),
      PageUp: Math.max(0, active - 4),
      Home: 0,
      End: last
    };
    if (e.key in moves) {
      e.preventDefault();
      active = moves[e.key];
      revealActive();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      // Close only the list, not the dialog it sits in.
      e.preventDefault();
      e.stopPropagation();
      closeList({ refocus: true });
    } else if (e.key === 'Tab') {
      closeList();
    }
  }

  /** @param {MouseEvent} e */
  function handleWindowClick(e) {
    if (!open || !root) return;
    if (e.target instanceof Node && !root.contains(e.target)) closeList();
  }
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
      class:input-error={invalid}
      aria-invalid={invalid || undefined}
      value={display}
      oninput={handleInput}
      onblur={handleBlur}
      {...rest}
    />
    <button
      type="button"
      class="btn join-item btn-outline"
      aria-label={m.time_picker_open()}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listboxId : undefined}
      bind:this={button}
      onclick={() => (open ? closeList() : openList())}
    >
      <ClockIcon class_="size-5" title="" />
    </button>
  </div>

  {#if open}
    <ul
      id={listboxId}
      role="listbox"
      tabindex="-1"
      aria-label={m.time_picker_options_label()}
      aria-activedescendant={optionId(active)}
      class="absolute right-0 z-50 mt-1 max-h-60 w-28 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg focus:outline-none"
      bind:this={listbox}
      onkeydown={handleListKeydown}
    >
      {#each SLOTS as slot, index (slot)}
        <!-- Keyboard handling lives on the listbox (aria-activedescendant). -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={optionId(index)}
          role="option"
          aria-selected={slot === value}
          class="cursor-pointer rounded-field px-3 py-1 text-center tabular-nums hover:bg-base-200"
          class:bg-base-200={index === active}
          class:font-semibold={slot === value}
          class:text-primary={slot === value}
          onclick={() => choose(index)}
        >
          {slot}
        </li>
      {/each}
    </ul>
  {/if}

  {#if invalid}
    <p class="mt-1 text-xs text-error" data-testid="time-input-invalid">
      {m.time_input_invalid_hint()}
    </p>
  {/if}
</div>
