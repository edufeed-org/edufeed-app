<!--
  The empty chat's "this is what you can do" cards. An open card is one button that starts
  the real thing; a locked one says what is needed and offers the way there.
-->
<script>
  import { capabilityCopy } from './termi-capabilities.svelte.js';

  /** @typedef {import('$lib/termi/capabilities.js').CapabilityCard} Card */
  /** @type {{ cards: Card[], onPick: (card: Card) => void }} */
  let { cards, onPick } = $props();
</script>

<div class="ml-[38px] flex flex-col gap-2" data-testid="termi-capabilities">
  {#each cards as card (card.id)}
    {@const copy = capabilityCopy(card)}
    {#if 'locked' in card}
      <div
        class="flex items-center gap-2.5 rounded-xl border border-dashed border-base-300 px-3 py-2.5"
        data-testid="termi-capability-{card.id}"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm leading-snug font-semibold text-base-content/70">{copy.title}</div>
          <div class="text-xs leading-snug text-base-content/70">{copy.text}</div>
        </div>
        {#if copy.action}
          <button type="button" class="btn btn-outline btn-sm" onclick={() => onPick(card)}>
            {copy.action}
          </button>
        {/if}
      </div>
    {:else}
      <button
        type="button"
        class="flex items-center gap-2.5 rounded-xl border border-base-300 bg-base-100 px-3 py-2.5 text-left hover:bg-base-200"
        data-testid="termi-capability-{card.id}"
        onclick={() => onPick(card)}
      >
        <span class="min-w-0 flex-1">
          <span class="block text-sm leading-snug font-semibold">{copy.title}</span>
          <span class="block text-xs leading-snug text-base-content/70">{copy.text}</span>
        </span>
        <span class="text-primary" aria-hidden="true">→</span>
      </button>
    {/if}
  {/each}
</div>
