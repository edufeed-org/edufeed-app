<script>
  // The import's preview → publishing → done states inside a Termi bubble.
  // Presentational: the window owns the ImportState and applies `onUpdate`.
  import * as m from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';

  /**
   * @typedef {import('$lib/helpers/calendar-import/events.js').ImportEvent} ImportEvent
   * @typedef {import('./publish-imported.js').ImportState} ImportState
   */

  /** @type {{ state: ImportState, onUpdate: (patch: Partial<ImportState>) => void, onPublish: () => void, onRetry: () => void }} */
  let { state, onUpdate, onPublish, onRetry } = $props();

  const events = $derived(state.events ?? []);
  const selected = $derived(state.selected ?? new Set());
  const usable = $derived(events.filter((e) => !e.problem));
  const hasDescriptions = $derived(usable.some((e) => e.description));
  const failedCount = $derived(state.result?.failed.length ?? 0);

  /** YYYY-MM-DD → DD.MM.YYYY @param {string} iso */
  function day(iso) {
    const [y, mo, d] = iso.split('-');
    return y && mo && d ? `${d}.${mo}.${y}` : iso;
  }

  /** DD.MM.YYYY HH:mm–HH:mm; all-day: DD.MM.YYYY[–DD.MM.YYYY] @param {ImportEvent} e */
  function when(e) {
    const multiDay = !!e.endDate && e.endDate !== e.startDate;
    if (e.allDay || !e.startTime) {
      return multiDay ? `${day(e.startDate)}–${day(e.endDate)}` : day(e.startDate);
    }
    const start = `${day(e.startDate)} ${e.startTime}`;
    if (multiDay) return `${start}–${day(e.endDate)}${e.endTime ? ` ${e.endTime}` : ''}`;
    return e.endTime ? `${start}–${e.endTime}` : start;
  }

  // Header checkbox: only rows that are tickable by default (no problem, not imported yet).
  const tickable = $derived(usable.filter((e) => !state.already?.has(e.key)).map((e) => e.key));
  const allTicked = $derived(tickable.length > 0 && tickable.every((k) => selected.has(k)));

  function toggleAll() {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a new value handed to onUpdate, never mutated after
    const next = new Set(selected);
    for (const k of tickable) {
      if (allTicked) next.delete(k);
      else next.add(k);
    }
    onUpdate({ selected: next });
  }

  /** @param {string} key */
  function toggle(key) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a new value handed to onUpdate, never mutated after
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onUpdate({ selected: next });
  }
</script>

{#if state.status === 'preview'}
  {#if usable.length === 0}
    <div>{m.termi_import_none()}</div>
    {#if state.truncated}
      <div class="mt-1 text-xs text-base-content/60">{m.termi_import_truncated()}</div>
    {/if}
  {:else}
    <div>{m.termi_import_found({ n: usable.length, file: state.source })}</div>
    {#if state.truncated}
      <div class="mt-1 text-xs text-base-content/60">{m.termi_import_truncated()}</div>
    {/if}
    <div class="mt-2 max-h-72 overflow-auto rounded-lg border border-base-300 bg-base-100">
      <table class="table table-xs">
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                class="checkbox checkbox-xs"
                data-testid="termi-import-all"
                aria-label={m.termi_import_select_all()}
                checked={allTicked}
                disabled={tickable.length === 0}
                onchange={toggleAll}
              />
            </th>
            <th>{m.termi_import_col_date()}</th>
            <th>{m.termi_import_col_title()}</th>
            <th>{m.termi_import_col_location()}</th>
          </tr>
        </thead>
        <tbody>
          {#each events as e (e.key)}
            <tr data-testid="termi-import-row" class={e.problem ? 'opacity-60' : ''}>
              <td>
                <input
                  type="checkbox"
                  class="checkbox checkbox-xs"
                  aria-label={e.title}
                  checked={!e.problem && selected.has(e.key)}
                  disabled={!!e.problem}
                  onchange={() => toggle(e.key)}
                />
              </td>
              <td class="whitespace-nowrap">{when(e)}</td>
              <td>
                {e.title}
                {#if e.problem}
                  <div class="text-error">
                    {e.problem === 'date'
                      ? m.termi_import_problem_date()
                      : m.termi_import_problem_title()}
                  </div>
                {:else if state.already?.has(e.key)}
                  <div class="text-base-content/60">{m.termi_import_already()}</div>
                {/if}
              </td>
              <td>{e.location ?? ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if hasDescriptions}
      <label class="mt-2 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          class="checkbox checkbox-xs"
          checked={state.withDescriptions}
          onchange={() => onUpdate({ withDescriptions: !state.withDescriptions })}
        />
        {m.termi_import_descriptions()}
      </label>
    {/if}
    <div class="mt-2 text-xs text-base-content/70">{m.termi_import_public_notice()}</div>
    <button
      type="button"
      class="btn mt-2 btn-sm btn-primary"
      disabled={selected.size === 0}
      onclick={onPublish}
    >
      {m.termi_import_publish({ n: selected.size })}
    </button>
  {/if}
{:else if state.status === 'publishing'}
  <div class="flex items-center gap-2">
    <span class="loading loading-xs loading-spinner"></span>
    {m.termi_import_progress({ done: state.done, total: selected.size })}
  </div>
  <div class="mt-1 text-xs text-base-content/60">{m.termi_import_signer_hint()}</div>
{:else if state.status === 'done'}
  <div>
    {m.termi_import_progress({
      done: state.result?.ok.length ?? 0,
      total: (state.result?.ok.length ?? 0) + failedCount
    })}
  </div>
  <div class="mt-2 flex flex-wrap gap-2">
    {#if failedCount > 0}
      <button type="button" class="btn btn-sm btn-primary" onclick={onRetry}>
        {m.termi_import_retry()}
      </button>
    {/if}
    <a href={resolve('/calendar')} class="btn btn-ghost btn-sm">{m.termi_import_done()}</a>
  </div>
{/if}
