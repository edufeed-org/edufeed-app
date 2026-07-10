<!--
  European/German 24-hour time input.

  Native `<input type="time">` renders in the browser's locale, which can show
  a 12-hour clock ("01:00 PM"). This is a text field masked to 24-hour `HH:MM`
  binding the same `HH:MM` string a native time input would, so callers don't
  change. Lenient typing (9:30, 9.30, 930, bare 13) normalizes on blur.

  `value` (bindable) is the `HH:MM` string; '' means empty or not-yet-valid.
-->
<script>
  import { parseTimeInput } from '$lib/helpers/dates.js';
  import * as m from '$lib/paraglide/messages';

  let {
    value = $bindable(''),
    id = undefined,
    placeholder = 'HH:MM',
    class: klass = 'input-bordered input w-full',
    ...rest
  } = $props();

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
</script>

<div>
  <input
    {id}
    type="text"
    inputmode="numeric"
    autocomplete="off"
    {placeholder}
    class={klass}
    class:input-error={invalid}
    aria-invalid={invalid || undefined}
    value={display}
    oninput={handleInput}
    onblur={handleBlur}
    {...rest}
  />
  {#if invalid}
    <p class="mt-1 text-xs text-error" data-testid="time-input-invalid">
      {m.time_input_invalid_hint()}
    </p>
  {/if}
</div>
