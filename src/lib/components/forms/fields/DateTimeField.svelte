<!--
  NIP-101-EDU `datetime` field: a date input plus a time input. The answer is
  `YYYY-MM-DD`, or the local wall-clock `YYYY-MM-DDTHH:MM` once a time is
  given. While the field named by `settings.allDayField` is checked the time
  input is hidden and the answer is the date alone; the typed time is kept and
  comes back when the switch is turned off again.
-->
<script>
  import { untrack } from 'svelte';
  import EuropeanDateInput from '$lib/components/shared/EuropeanDateInput.svelte';
  import EuropeanTimeInput from '$lib/components/shared/EuropeanTimeInput.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * Registry contract plus `values`, the form's current answers (to read the
   * all-day switch).
   * @type {{
   *   field: import('$lib/helpers/forms.js').FormField,
   *   value?: string,
   *   error?: string | null,
   *   readonly?: boolean,
   *   onchange: (value: string) => void,
   *   values?: Record<string, any>
   * }}
   */
  let { field, value = '', error = null, readonly = false, onchange, values = {} } = $props();

  /** @param {unknown} v */
  const datePart = (v) => (typeof v === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(v)?.[0] || '' : '');
  /** @param {unknown} v */
  const timePart = (v) => (typeof v === 'string' ? /T(\d{2}:\d{2})/.exec(v)?.[1] || '' : '');

  const allDay = $derived.by(() => {
    const switchId = field.options?.allDayField;
    if (typeof switchId !== 'string' || !switchId) return false;
    const v = values?.[switchId];
    return v === true || v === 'true';
  });

  let date = $state(untrack(() => datePart(value)));
  let time = $state(untrack(() => timePart(value)));
  // The last answer this field produced, to tell its own echo from an
  // external change (prefill) of `value`.
  let emitted = untrack(() => value);

  // External value changes (edit-mode prefill) reach the inputs. A date-only
  // value keeps the typed time while the all-day switch is on.
  $effect(() => {
    const v = value ?? '';
    if (v === emitted) return;
    emitted = v;
    date = datePart(v);
    const t = timePart(v);
    if (t || !untrack(() => allDay)) time = t;
  });

  $effect(() => {
    const next = !date ? '' : allDay || !time ? date : `${date}T${time}`;
    if (next === untrack(() => value ?? '')) return;
    emitted = next;
    onchange(next);
  });
</script>

<div class="flex gap-2">
  <div class="min-w-0 flex-1">
    <EuropeanDateInput
      id={field.id}
      bind:value={date}
      placeholder={field.options?.placeholder || 'TT.MM.JJJJ'}
      class={`input-bordered input w-full ${error ? 'input-error' : ''}`}
      disabled={readonly}
    />
  </div>
  {#if !allDay}
    <div class="w-32 shrink-0">
      <EuropeanTimeInput
        id={`${field.id}-time`}
        bind:value={time}
        aria-label={m.form_datetime_time_label()}
        class={`input-bordered input w-full ${error ? 'input-error' : ''}`}
        disabled={readonly}
      />
    </div>
  {/if}
</div>
