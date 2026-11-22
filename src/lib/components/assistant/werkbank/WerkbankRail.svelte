<script>
  // The Werkbank's left column: the planning steps, then the parts of the draft.
  import * as m from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import { PHASE_LABELS } from '$lib/termi/lesson-state.js';
  import { partTitle } from './part-title.js';

  /** @typedef {{ type: 'step', n: number } | { type: 'part', key: string } | null} Selection */
  /**
   * @type {{
   *   rows: ReturnType<typeof import('$lib/termi/werkbank.js').railRows>,
   *   selected: Selection,
   *   onselect: (sel: NonNullable<Selection>) => void
   * }}
   */
  let { rows, selected, onselect } = $props();
  const labels = $derived(getLocale() === 'de' ? PHASE_LABELS.de : PHASE_LABELS.en);

  /** @param {string} state */
  function stateLabel(state) {
    switch (state) {
      case 'writing':
        return m.termi_werkbank_state_writing();
      case 'failed':
        return m.termi_werkbank_state_failed();
      case 'changed':
        return m.termi_werkbank_state_changed();
      case 'saved':
        return m.termi_werkbank_state_saved();
      default:
        return m.termi_werkbank_state_todo();
    }
  }
</script>

<nav
  aria-label={m.termi_werkbank_outline()}
  class="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r border-base-300 bg-base-200 p-2"
>
  {#if rows.steps.length}
    <div>
      <div class="px-3 pb-1 text-xs font-semibold text-base-content/60">
        {m.termi_werkbank_steps()}
      </div>
      <ul class="menu w-full menu-sm p-0">
        {#each rows.steps as step (step.n)}
          {@const current = selected?.type === 'step' && selected.n === step.n}
          <li>
            <button
              type="button"
              data-testid="werkbank-step"
              data-state={step.state}
              disabled={step.state === 'todo'}
              aria-current={current ? 'true' : undefined}
              class={current ? 'menu-active' : ''}
              onclick={() => onselect({ type: 'step', n: step.n })}
            >
              <span
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold {step.state ===
                'current'
                  ? 'bg-primary text-primary-content'
                  : step.state === 'done'
                    ? 'bg-primary/20 text-primary'
                    : 'bg-base-300 text-base-content/40'}"
                >{step.state === 'done' ? '✓' : step.n}</span
              >
              {labels[step.n - 1]}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  <div>
    <div class="px-3 pb-1 text-xs font-semibold text-base-content/60">
      {m.termi_werkbank_parts()}
    </div>
    <ul class="menu w-full menu-sm p-0">
      {#each rows.parts as row (row.key)}
        {@const current = selected?.type === 'part' && selected.key === row.key}
        <li>
          <button
            type="button"
            data-testid="werkbank-part"
            data-state={row.state}
            aria-current={current ? 'true' : undefined}
            title={stateLabel(row.state)}
            class="{current ? 'menu-active' : ''} {row.state === 'todo'
              ? 'text-base-content/50'
              : ''}"
            onclick={() => onselect({ type: 'part', key: row.key })}
          >
            <span class="min-w-0 flex-1 truncate">{partTitle(row.key, row.title)}</span>
            {#if row.state === 'writing'}
              <span class="loading loading-xs loading-spinner" aria-hidden="true"></span>
            {:else if row.state === 'saved'}
              <span class="text-success" aria-hidden="true">✓</span>
            {:else if row.state === 'changed'}
              <span class="h-2 w-2 rounded-full bg-warning" aria-hidden="true"></span>
            {:else if row.state === 'failed'}
              <span class="font-bold text-error" aria-hidden="true">!</span>
            {/if}
            <span class="sr-only">{stateLabel(row.state)}</span>
          </button>
        </li>
      {/each}
    </ul>
  </div>
</nav>
