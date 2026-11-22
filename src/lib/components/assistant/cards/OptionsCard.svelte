<script>
  // A propose_options card: the model asks, the teacher clicks, her choice is
  // the next user message. Without `onSend` (an older or restored answer, or a
  // running chat) it is shown muted and takes no clicks.
  import * as m from '$lib/paraglide/messages';
  import { uniqueBy } from '$lib/helpers/unique.js';
  import { SvelteSet } from 'svelte/reactivity';

  /** @type {{ card: import('$lib/termi/tool-registry.js').OptionsCard, onSend?: (text: string) => void }} */
  let { card, onSend } = $props();

  // toOptions dedupes already; a keyed each over model output stays defensive anyway
  const options = $derived(uniqueBy(card.options, (o) => o.id));
  const picked = new SvelteSet();

  function apply() {
    const list = options
      .filter((o) => picked.has(o.id))
      .map((o) => o.label)
      .join('; ');
    if (list) onSend?.(m.termi_lesson_options_selected({ list }));
  }
</script>

<div
  class="mt-2 flex flex-col gap-2 {onSend ? '' : 'opacity-60'}"
  data-testid="termi-options"
  data-inert={onSend ? undefined : 'true'}
>
  {#if card.question}
    <p class="font-medium">{card.question}</p>
  {/if}
  {#if card.multi}
    {#each options as option (option.id)}
      <label class="flex items-start gap-2" data-testid="termi-option">
        <input
          type="checkbox"
          class="checkbox mt-0.5 checkbox-sm"
          disabled={!onSend}
          checked={picked.has(option.id)}
          onchange={(e) =>
            e.currentTarget.checked ? picked.add(option.id) : picked.delete(option.id)}
        />
        <span>
          {option.label}
          {#if option.hint}<span class="block text-xs text-base-content/60">{option.hint}</span
            >{/if}
        </span>
      </label>
    {/each}
    <div>
      <button
        type="button"
        class="btn btn-sm btn-primary"
        data-testid="termi-options-apply"
        disabled={!onSend || picked.size === 0}
        onclick={apply}
      >
        {m.termi_lesson_options_apply()}
      </button>
    </div>
  {:else}
    <div class="flex flex-wrap gap-2">
      {#each options as option (option.id)}
        <button
          type="button"
          class="btn h-auto min-h-8 flex-col items-start py-1 btn-sm"
          data-testid="termi-option"
          disabled={!onSend}
          onclick={() => onSend?.(option.label)}
        >
          {option.label}
          {#if option.hint}<span class="text-xs font-normal text-base-content/60"
              >{option.hint}</span
            >{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
