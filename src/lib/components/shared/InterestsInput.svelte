<!--
  InterestsInput — free-form tag chips for profile interests.
  Adds on Enter/comma, removes via chip button, dedupes case-insensitively.
  Dumb component: emits the full new array via `onchange`, never mutates `value`.
-->
<script>
  import { CloseIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {string[]} [value]
   * @property {(value: string[]) => void} [onchange]
   * @property {number} [maxCount]
   */
  /** @type {Props} */
  let { value = [], onchange, maxCount = 20 } = $props();

  let draft = $state('');

  const atMax = $derived(value.length >= maxCount);

  function addDraft() {
    const interest = draft.trim();
    draft = '';
    if (!interest || atMax) return;
    if (value.some((v) => v.toLowerCase() === interest.toLowerCase())) return;
    onchange?.([...value, interest]);
  }

  /** @param {KeyboardEvent} event */
  function handleKeydown(event) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addDraft();
    }
  }

  /** @param {string} interest */
  function remove(interest) {
    onchange?.(value.filter((v) => v !== interest));
  }
</script>

<div class="flex flex-col gap-2">
  {#if value.length > 0}
    <div class="flex flex-wrap gap-2">
      {#each value as interest (interest)}
        <span class="badge gap-1 badge-outline py-3 badge-primary">
          {interest}
          <button
            type="button"
            class="cursor-pointer"
            aria-label={m.interests_remove({ name: interest })}
            onclick={() => remove(interest)}
          >
            <CloseIcon class_="w-3 h-3" />
          </button>
        </span>
      {/each}
    </div>
  {/if}
  <input
    type="text"
    class="input-bordered input w-full"
    placeholder={m.interests_placeholder()}
    bind:value={draft}
    onkeydown={handleKeydown}
    onblur={addDraft}
    disabled={atMax}
  />
</div>
