<script>
  import { untrack } from 'svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { generateOptionId } from '$lib/helpers/polls.js';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';

  /**
   * @typedef {Object} Props
   * @property {string} [communityPubkey]
   */
  /** @type {Props} */
  let { communityPubkey = '' } = $props();

  let question = $state('');
  /** @type {{ id: string; label: string }[]} */
  let options = $state([
    { id: generateOptionId(), label: '' },
    { id: generateOptionId(), label: '' }
  ]);
  /** @type {'singlechoice' | 'multiplechoice'} */
  let pollType = $state('singlechoice');

  /** @type {'24h' | '7d' | '30d' | 'none' | 'custom'} */
  let endsAtPreset = $state('7d');
  let customEndsAt = $state('');

  let community = $state(untrack(() => communityPubkey));

  const getJoinedCommunities = useJoinedCommunitiesList();
  let communities = $derived(getJoinedCommunities());
  const getProfileMap = useProfileMap(() => communities);
  let profileMap = $derived(getProfileMap());
  let communityPubkeys = $derived(
    communityPubkey && !communities.includes(communityPubkey)
      ? [communityPubkey, ...communities]
      : communities
  );

  function addOption() {
    options = [...options, { id: generateOptionId(), label: '' }];
  }

  function removeOption(/** @type {number} */ idx) {
    if (options.length <= 2) return;
    options = options.filter((_, i) => i !== idx);
  }

  let trimmedLabels = $derived(options.map((o) => o.label.trim()));
  let hasDuplicates = $derived.by(() => {
    const lower = trimmedLabels.filter(Boolean).map((s) => s.toLowerCase());
    return new Set(lower).size !== lower.length;
  });
  let hasEmpty = $derived(trimmedLabels.some((s) => s === ''));
  let questionValid = $derived(question.trim().length > 0 && question.trim().length <= 280);
  let customEndsAtValid = $derived.by(() => {
    if (endsAtPreset === 'custom') return customEndsAt !== '';
    return true;
  });
  let canSubmit = $derived(
    questionValid && options.length >= 2 && !hasEmpty && !hasDuplicates && customEndsAtValid
  );

  async function handleSubmit() {
    // Implemented in Task 4.
  }
</script>

<dialog open class="modal-open modal">
  <div class="modal-box max-w-xl">
    <h3 class="mb-4 text-lg font-bold">Create poll</h3>

    <label class="form-control mb-3">
      <span class="label-text">Question</span>
      <textarea
        class="textarea-bordered textarea"
        placeholder="Question (e.g. What pizza topping?)"
        bind:value={question}
        maxlength="280"
        rows="2"
      ></textarea>
      <span class="label-text-alt mt-1">{question.length}/280</span>
    </label>

    <div class="mb-3">
      <span class="label-text mb-2 block">Options</span>
      {#each options as option, i (option.id)}
        <div class="mb-2 flex gap-2">
          <input
            class="input-bordered input flex-1"
            placeholder={`Option ${i + 1}`}
            bind:value={option.label}
          />
          {#if options.length > 2}
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onclick={() => removeOption(i)}
              aria-label="Remove option"
            >
              ×
            </button>
          {/if}
        </div>
      {/each}
      <button type="button" class="btn btn-ghost btn-sm" onclick={addOption}>+ Add option</button>
    </div>

    <div class="mb-3">
      <span class="label-text mb-2 block">Type</span>
      <div class="flex gap-4">
        <label class="flex cursor-pointer items-center gap-2">
          <input type="radio" class="radio" bind:group={pollType} value="singlechoice" />
          <span>Single choice</span>
        </label>
        <label class="flex cursor-pointer items-center gap-2">
          <input type="radio" class="radio" bind:group={pollType} value="multiplechoice" />
          <span>Multiple choice</span>
        </label>
      </div>
    </div>

    <div class="mb-3">
      <span class="label-text mb-2 block">Ends</span>
      <div class="flex flex-wrap gap-2">
        {#each [['24h', '24h'], ['7d', '7 days'], ['30d', '30 days'], ['none', 'No end date'], ['custom', 'Custom…']] as [val, label] (val)}
          <button
            type="button"
            class="btn btn-sm {endsAtPreset === val ? 'btn-primary' : 'btn-ghost'}"
            aria-pressed={endsAtPreset === val}
            onclick={() => (endsAtPreset = /** @type {any} */ (val))}
          >
            {label}
          </button>
        {/each}
      </div>
      {#if endsAtPreset === 'custom'}
        <input type="datetime-local" class="input-bordered input mt-2" bind:value={customEndsAt} />
      {/if}
    </div>

    <label class="form-control mb-4">
      <span class="label-text">Community (optional)</span>
      <select class="select-bordered select" bind:value={community} aria-label="Community">
        <option value="">— None —</option>
        {#each communityPubkeys as pubkey (pubkey)}
          {@const profile = profileMap.get(pubkey)}
          <option value={pubkey}>{getDisplayName(profile) || pubkey.slice(0, 8)}</option>
        {/each}
      </select>
    </label>

    <p class="mb-3 text-xs opacity-70">
      Your vote will be publicly tied to your Nostr identity. Voters and counts are visible to
      anyone.
    </p>

    <div class="modal-action">
      <button type="button" class="btn btn-ghost" onclick={() => modalStore.closeModal()}
        >Cancel</button
      >
      <button type="button" class="btn btn-primary" disabled={!canSubmit} onclick={handleSubmit}>
        Publish poll
      </button>
    </div>
  </div>
  <button
    type="button"
    class="modal-backdrop"
    aria-label="Close"
    onclick={() => modalStore.closeModal()}
  ></button>
</dialog>
