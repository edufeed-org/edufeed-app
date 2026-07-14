<script>
  import { PollFactory } from 'applesauce-common/factories';
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { nip19 } from 'nostr-tools';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { generateOptionId } from '$lib/helpers/polls.js';
  import { pollDraftHolder, freshPollDraft } from '$lib/stores/poll-draft.js';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { finalizeDraft } from '$lib/helpers/event-factory.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { manager } from '$lib/stores/accounts.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

  /**
   * @typedef {Object} Props
   * @property {string} [communityPubkey]
   */
  /** @type {Props} */
  let { communityPubkey = '' } = $props();

  let question = $state(pollDraftHolder.value.question);
  /** @type {{ id: string; label: string }[]} */
  let options = $state(pollDraftHolder.value.options.map((o) => ({ ...o })));
  /** @type {'singlechoice' | 'multiplechoice'} */
  let pollType = $state(pollDraftHolder.value.pollType);

  /** @type {'24h' | '7d' | '30d' | 'none' | 'custom'} */
  let endsAtPreset = $state(pollDraftHolder.value.endsAtPreset);
  let customEndsAt = $state(pollDraftHolder.value.customEndsAt);

  // If the modal was opened with an explicit communityPubkey prop, prefer that
  // over any saved draft community — a fresh "create poll in this community"
  // intent should win over the previous selection.
  let community = $state(untrack(() => communityPubkey || pollDraftHolder.value.community));

  // Persist on every change so the draft survives modal close.
  $effect(() => {
    pollDraftHolder.value = {
      question,
      options: options.map((o) => ({ ...o })),
      pollType,
      endsAtPreset,
      customEndsAt,
      community
    };
  });

  function startOver() {
    const fresh = freshPollDraft();
    question = fresh.question;
    options = fresh.options;
    pollType = fresh.pollType;
    endsAtPreset = fresh.endsAtPreset;
    customEndsAt = fresh.customEndsAt;
    community = communityPubkey || fresh.community;
    submitError = '';
  }

  let isSubmitting = $state(false);
  let submitError = $state('');

  // Minimum lead time for custom end timestamps (5 minutes from now).
  const CUSTOM_ENDS_AT_MIN_LEAD_SECONDS = 5 * 60;
  function customEndsAtSeconds() {
    if (!customEndsAt) return null;
    const ts = Math.floor(new Date(customEndsAt).getTime() / 1000);
    return Number.isFinite(ts) ? ts : null;
  }

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
    if (endsAtPreset !== 'custom') return true;
    const ts = customEndsAtSeconds();
    if (ts === null) return false;
    const now = Math.floor(Date.now() / 1000);
    return ts > now + CUSTOM_ENDS_AT_MIN_LEAD_SECONDS;
  });
  let canSubmit = $derived(
    questionValid &&
      options.length >= 2 &&
      !hasEmpty &&
      !hasDuplicates &&
      customEndsAtValid &&
      !isSubmitting
  );

  function computeEndsAt() {
    const now = Math.floor(Date.now() / 1000);
    if (endsAtPreset === '24h') return now + 24 * 3600;
    if (endsAtPreset === '7d') return now + 7 * 24 * 3600;
    if (endsAtPreset === '30d') return now + 30 * 24 * 3600;
    if (endsAtPreset === 'none') return null;
    if (endsAtPreset === 'custom') {
      const ts = customEndsAtSeconds();
      if (ts !== null && ts > now + CUSTOM_ENDS_AT_MIN_LEAD_SECONDS) return ts;
    }
    return null;
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    const currentAccount = manager.active;
    if (!currentAccount) {
      submitError = 'You must be logged in to create a poll.';
      return;
    }

    isSubmitting = true;
    submitError = '';

    try {
      /** @type {any | null} */
      let communityEvent = null;
      if (community) {
        communityEvent = eventStore.getReplaceable(10222, community) || null;
      }

      const endsAt = computeEndsAt();
      let pollFactory = PollFactory.create(
        question.trim(),
        options.map((o) => ({ id: o.id, label: o.label.trim() }))
      ).pollType(pollType);
      if (endsAt != null) pollFactory = pollFactory.endsAt(endsAt);
      const template = await finalizeDraft(pollFactory);

      // PollFactory does not add h-tag; append for community targeting.
      if (community) template.tags.push(['h', community]);

      const signed = await currentAccount.signEvent(template);

      eventStore.add(signed);
      const result = await publishEvent(signed, [], { communityEvent });

      // Successful publish — clear the draft so reopening starts fresh.
      pollDraftHolder.value = freshPollDraft();
      modalStore.closeModal();

      const nevent = nip19.neventEncode({
        id: signed.id,
        author: signed.pubkey,
        relays: result?.relays?.slice(0, 3) ?? []
      });
      if (community) {
        const npub = nip19.npubEncode(community);
        goto(resolve(/** @type {any} */ (`/c/${npub}/${nevent}`)));
      } else {
        goto(resolve(/** @type {any} */ (`/${nevent}`)));
      }
    } catch (err) {
      submitError = /** @type {any} */ (err)?.message ?? String(err);
    } finally {
      isSubmitting = false;
    }
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

    {#if submitError}
      <div class="mb-3 alert alert-error" role="alert">
        <span class="text-sm">{submitError}</span>
      </div>
    {/if}

    <div class="modal-action">
      <button type="button" class="btn btn-ghost" disabled={isSubmitting} onclick={startOver}
        >Start over</button
      >
      <button
        type="button"
        class="btn btn-ghost"
        disabled={isSubmitting}
        onclick={() => modalStore.closeModal()}>Cancel</button
      >
      <button
        type="button"
        class="btn btn-primary"
        disabled={!canSubmit || isSubmitting}
        onclick={handleSubmit}
      >
        {#if isSubmitting}
          <span class="loading loading-sm loading-spinner"></span>
        {/if}
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
