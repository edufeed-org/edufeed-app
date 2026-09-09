<script>
  import { getPollType } from 'applesauce-common/helpers';
  import { PollResponseFactory } from 'applesauce-common/factories';
  import { getTagValue, getDisplayName } from 'applesauce-core/helpers';
  import { tallyPollVotes, extractPollRelayTags, getPollOptionsPure } from '$lib/helpers/polls.js';
  import { pollResponsesLoader } from '$lib/loaders/polls.js';
  import { manager } from '$lib/stores/accounts.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { finalizeDraft } from '$lib/helpers/event-factory.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import * as m from '$lib/paraglide/messages.js';
  import { resolve } from '$app/paths';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import EventContextMenu from '$lib/components/shared/EventContextMenu.svelte';
  import PollBody from '$lib/components/polls/PollBody.svelte';
  import { profileLink } from '$lib/helpers/nostrUtils.js';

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

  // Unique pubkeys for batched profile loading: poll author + all voters.
  let allVoterPubkeys = $derived(
    Array.from(new Set(Array.from(tally.byOption.values()).flatMap((s) => s.voters)))
  );
  const getProfiles = useProfileMap(() => [event.pubkey, ...allVoterPubkeys]);
  // Resolve profiles once per render rather than per option iteration.
  let profiles = $derived(getProfiles());
  let authorProfile = $derived(profiles.get(event.pubkey));
  let authorName = $derived(getDisplayName(authorProfile, event.pubkey.slice(0, 8) + '…'));

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

  /**
   * Sign + publish a kind-1018 response for the chosen options. Resolves true
   * on success so PollBody clears its selection; false keeps it for a retry.
   * @param {string[]} optionIds
   */
  async function castVote(optionIds) {
    const account = manager.active;
    if (!account || optionIds.length === 0) return false;
    let signed;
    try {
      const template = await finalizeDraft(PollResponseFactory.create(event, optionIds));
      signed = await account.signEvent(template);
    } catch (err) {
      console.warn('Vote sign failed', err);
      return false;
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
      return false;
    }
    return true;
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
    <a
      href={resolve(profileLink(event.pubkey))}
      class="truncate text-sm text-base-content/80 hover:underline"
    >
      {authorName}
    </a>
  </div>

  <p data-testid="poll-question" class="text-lg font-semibold {truncate ? 'line-clamp-3' : ''}">
    {event.content}
  </p>

  <!-- Keyed on the poll id so selection / reveal state resets when the card
       is reused for a different poll. -->
  {#key event.id}
    <PollBody
      options={pollOptions}
      {pollType}
      byOption={tally.byOption}
      totalVoters={tally.totalVoters}
      userVote={tally.userVote}
      {isClosed}
      {endsAt}
      canVote={!!manager.active}
      onCastVote={castVote}
      {profiles}
    />
  {/key}
</div>
