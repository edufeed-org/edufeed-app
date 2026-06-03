<script>
  import { getPollType } from 'applesauce-common/helpers';
  import { PollResponseBlueprint } from 'applesauce-common/blueprints';
  import { getTagValue, getDisplayName } from 'applesauce-core/helpers';
  import { tallyPollVotes, extractPollRelayTags, getPollOptionsPure } from '$lib/helpers/polls.js';
  import { pollResponsesLoader } from '$lib/loaders/polls.js';
  import { manager } from '$lib/stores/accounts.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import * as m from '$lib/paraglide/messages.js';
  import { resolve } from '$app/paths';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import EventContextMenu from '$lib/components/shared/EventContextMenu.svelte';
  import HoverCard from '$lib/components/shared/HoverCard.svelte';

  /**
   * @typedef {Object} Props
   * @property {any} event - kind 1068 poll event
   * @property {boolean} [truncate] - clamp question to 3 lines (for feeds/embeds)
   * @property {(() => void) | undefined} [onclick] - if provided, the card body becomes clickable (navigates to detail page). Interactive descendants (options, vote button, menu, avatars) stop propagation.
   */
  /** @type {Props} */
  let { event, truncate = false, onclick = undefined } = $props();

  /** @param {KeyboardEvent} e */
  function handleKeydown(e) {
    if (!onclick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onclick();
    }
  }

  /** @param {Event} e */
  function stop(e) {
    e.stopPropagation();
  }

  // Use pure parse — applesauce's getPollOptions caches via Symbol mutation
  // which triggers state_unsafe_mutation inside $derived.
  let pollOptions = $derived(getPollOptionsPure(event));
  let pollType = $derived(getPollType(event));

  let endsAt = $derived.by(() => {
    const raw = getTagValue(event, 'endsAt');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  });
  // Tick `now` periodically so `isClosed` flips while the card is on screen.
  let now = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    if (endsAt === null) return;
    if (now > endsAt) return; // already closed; no need to keep ticking
    const id = setInterval(() => {
      now = Math.floor(Date.now() / 1000);
    }, 30_000);
    return () => clearInterval(id);
  });
  let isClosed = $derived(endsAt !== null && now > endsAt);

  /** @type {string[]} */
  let selected = $state([]);
  let revealed = $state(false);
  let submitting = $state(false);

  // Load + subscribe to kind 1018 responses targeting this poll. The loader
  // fetches past responses from the poll's relay tags + community relays +
  // fallback into EventStore; the model subscription then reflects them
  // (and any live ones) into `responses`. Plain `let` for subscription handles —
  // they are internal refs and must not trigger re-renders.
  /** @type {any[]} */
  let responses = $state.raw([]);
  /** @type {import('rxjs').Subscription | undefined} */
  let modelSub;
  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSub;
  $effect(() => {
    // Track event.id so prop changes re-run this effect.
    const _id = event.id;
    // Reset per-poll UI state.
    selected = [];
    revealed = false;

    modelSub?.unsubscribe();
    loaderSub?.unsubscribe();

    // 1. Fetch past responses from relays into EventStore.
    loaderSub = pollResponsesLoader(event)().subscribe();

    // 2. Subscribe to EventStore for past + live responses.
    modelSub = eventStore
      .timeline({ kinds: [1018], '#e': [event.id] })
      .subscribe((/** @type {any[]} */ events) => {
        responses = events ?? [];
      });

    return () => {
      modelSub?.unsubscribe();
      loaderSub?.unsubscribe();
    };
  });

  let tally = $derived(tallyPollVotes(event, responses, manager.active?.pubkey));
  let hasVoted = $derived(tally.userVote !== null);
  let showResults = $derived(hasVoted || revealed || isClosed);

  // Unique pubkeys for batched profile loading: poll author + all voters.
  let allVoterPubkeys = $derived(
    Array.from(new Set(Array.from(tally.byOption.values()).flatMap((s) => s.voters)))
  );
  const getProfiles = useProfileMap(() => [event.pubkey, ...allVoterPubkeys]);
  // Resolve profiles once per render rather than per option iteration.
  let profiles = $derived(getProfiles());
  let authorProfile = $derived(profiles.get(event.pubkey));
  let authorName = $derived(getDisplayName(authorProfile, event.pubkey.slice(0, 8) + '…'));

  function toggleSelection(/** @type {string} */ id) {
    if (showResults) return;
    if (pollType === 'multiplechoice') {
      selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    } else {
      selected = [id];
    }
  }

  function pct(/** @type {number} */ count) {
    if (!tally.totalVoters) return 0;
    return Math.round((count / tally.totalVoters) * 100);
  }

  function formatEndsAt(/** @type {number} */ ts) {
    try {
      return new Date(ts * 1000).toLocaleString();
    } catch {
      return String(ts);
    }
  }

  let isAuthor = $derived(manager.active?.pubkey === event.pubkey);

  async function handleDelete() {
    const account = manager.active;
    if (!account || !isAuthor) return;
    try {
      await deleteEvent(event, account);
    } catch (err) {
      console.warn('Poll delete failed', err);
    }
  }

  async function castVote() {
    if (submitting) return;
    const account = manager.active;
    if (!account || selected.length === 0) return;
    submitting = true;
    try {
      let signed;
      try {
        const factory = createAppEventFactory();
        const template = await factory.create(PollResponseBlueprint, event, selected);
        signed = await account.signEvent(template);
      } catch (err) {
        console.warn('Vote sign failed', err);
        return;
      }

      // Resolve community event if poll is community-targeted (h-tag).
      const communityHex = getTagValue(event, 'h');
      const communityEvent = communityHex ? eventStore.getReplaceable(10222, communityHex) : null;

      // Optimistic update.
      eventStore.add(signed);

      try {
        await publishEvent(signed, [], {
          communityEvent,
          additionalRelays: extractPollRelayTags(event)
        });
      } catch (err) {
        console.warn('Vote publish failed', err);
        eventStore.remove(signed);
        return;
      }

      selected = [];
    } finally {
      submitting = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="relative rounded-box border border-base-300 bg-base-100 p-4 {onclick
    ? 'cursor-pointer transition-shadow hover:border-primary hover:shadow-md'
    : ''}"
  role={onclick ? 'button' : undefined}
  tabindex={onclick ? 0 : undefined}
  {onclick}
  onkeydown={handleKeydown}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="absolute top-3 right-3" onclick={stop} onkeydown={stop}>
    <EventContextMenu
      {event}
      onDelete={isAuthor ? handleDelete : undefined}
      deleteTitle={m.poll_delete_confirm_title()}
      deleteItemName={event.content}
    />
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    data-testid="poll-author"
    class="mb-3 flex items-center gap-2 pr-10"
    onclick={stop}
    onkeydown={stop}
  >
    <ProfileAvatar
      pubkey={event.pubkey}
      profile={authorProfile}
      size="xs"
      linkToProfile
      showHoverCard
    />
    <span class="truncate text-sm text-base-content/80">{authorName}</span>
  </div>

  <p data-testid="poll-question" class="text-lg font-semibold {truncate ? 'line-clamp-3' : ''}">
    {event.content}
  </p>

  <div class="mt-1 mb-3 flex flex-wrap items-center gap-2 text-xs text-base-content/70">
    <span>{pollType === 'multiplechoice' ? 'Multiple choice' : 'Single choice'}</span>
    <span aria-hidden="true">·</span>
    <span>{tally.totalVoters} voter{tally.totalVoters === 1 ? '' : 's'}</span>
    {#if hasVoted}
      <span aria-hidden="true">·</span>
      <span class="badge badge-sm badge-success" data-testid="poll-you-voted">You voted</span>
    {/if}
    {#if isClosed}
      <span aria-hidden="true">·</span>
      <span class="badge badge-ghost badge-sm">Poll closed</span>
    {:else if endsAt !== null}
      <span aria-hidden="true">·</span>
      <span>Ends {formatEndsAt(endsAt)}</span>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    {#each pollOptions as opt (opt.id)}
      {@const slot = tally.byOption.get(opt.id)}
      {@const count = slot?.count ?? 0}
      {@const userPicked = tally.userVote?.includes(opt.id) ?? false}
      {#if showResults}
        <div>
          <div class="relative overflow-hidden rounded-md border border-base-300">
            <div
              class="absolute inset-y-0 left-0 bg-primary/10"
              style="width: {pct(count)}%"
              aria-hidden="true"
            ></div>
            <div class="relative flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span class="truncate">{userPicked ? '✓ ' : ''}{opt.label}</span>
              <span class="tabular-nums opacity-80">{pct(count)}% · {count}</span>
            </div>
          </div>
          {#if (slot?.voters?.length ?? 0) > 0}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="mt-1.5 flex items-center -space-x-2" onclick={stop} onkeydown={stop}>
              {#each (slot?.voters ?? []).slice(0, 6) as voterPubkey (voterPubkey)}
                {@const profile = profiles.get(voterPubkey)}
                <div
                  data-testid="voter-avatar"
                  class="flex-shrink-0 rounded-full ring-2 ring-base-100"
                >
                  <ProfileAvatar
                    pubkey={voterPubkey}
                    {profile}
                    size="2xs"
                    linkToProfile
                    showHoverCard
                  />
                </div>
              {/each}
              {#if (slot?.voters?.length ?? 0) > 6}
                {@const overflow = (slot?.voters ?? []).slice(6)}
                <HoverCard>
                  {#snippet trigger()}
                    <span
                      class="ml-3 cursor-pointer text-xs opacity-60 hover:underline"
                      data-testid="poll-overflow-voters"
                    >
                      +{overflow.length}
                    </span>
                  {/snippet}
                  {#snippet content()}
                    <ul class="max-h-64 w-48 overflow-y-auto p-1">
                      {#each overflow as voterPubkey (voterPubkey)}
                        {@const profile = profiles.get(voterPubkey)}
                        {@const name = getDisplayName(profile, voterPubkey.slice(0, 8) + '…')}
                        <li>
                          <a
                            href={resolve(`/p/${voterPubkey}`)}
                            class="flex items-center gap-2 rounded px-2 py-1 hover:bg-base-200"
                          >
                            <ProfileAvatar pubkey={voterPubkey} {profile} size="2xs" />
                            <span class="truncate text-sm">{name}</span>
                          </a>
                        </li>
                      {/each}
                    </ul>
                  {/snippet}
                </HoverCard>
              {/if}
            </div>
          {/if}
        </div>
      {:else}
        <button
          type="button"
          class="btn justify-start btn-sm {selected.includes(opt.id)
            ? 'btn-primary'
            : 'btn-outline'}"
          aria-pressed={selected.includes(opt.id)}
          onclick={(e) => {
            e.stopPropagation();
            toggleSelection(opt.id);
          }}
        >
          {opt.label}
        </button>
      {/if}
    {/each}
  </div>

  {#if !showResults && !isClosed}
    <div class="mt-3 flex flex-wrap items-center gap-2">
      {#if manager.active}
        <button
          type="button"
          class="btn btn-sm btn-primary"
          disabled={selected.length === 0 || submitting}
          onclick={(e) => {
            e.stopPropagation();
            castVote();
          }}
        >
          Cast vote
        </button>
      {:else}
        <span class="text-sm text-base-content/60">Log in to vote</span>
      {/if}
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        onclick={(e) => {
          e.stopPropagation();
          revealed = true;
        }}
      >
        Show results without voting
      </button>
    </div>
  {:else if revealed && !hasVoted && !isClosed}
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        onclick={(e) => {
          e.stopPropagation();
          revealed = false;
        }}
      >
        Back to vote
      </button>
    </div>
  {/if}
</div>
