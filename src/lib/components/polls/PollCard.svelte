<script>
  import { getPollOptions, getPollType } from 'applesauce-common/helpers';
  import { getTagValue } from 'applesauce-core/helpers';
  import { tallyPollVotes } from '$lib/helpers/polls.js';
  import { manager } from '$lib/stores/accounts.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

  /**
   * @typedef {Object} Props
   * @property {any} event - kind 1068 poll event
   * @property {boolean} [truncate] - clamp question to 3 lines (for feeds/embeds)
   */
  /** @type {Props} */
  let { event, truncate = false } = $props();

  let pollOptions = $derived(getPollOptions(event));
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

  // Subscribe to kind 1018 responses targeting this poll. Plain `let`, not $state —
  // the subscription handle is internal and must not trigger re-renders.
  /** @type {any[]} */
  let responses = $state.raw([]);
  /** @type {import('rxjs').Subscription | undefined} */
  let sub;
  $effect(() => {
    // Track event.id so prop changes re-run this effect.
    const _id = event.id;
    // Reset per-poll UI state.
    selected = [];
    revealed = false;

    sub?.unsubscribe();
    sub = eventStore
      .timeline({ kinds: [1018], '#e': [event.id] })
      .subscribe((/** @type {any[]} */ events) => {
        responses = events ?? [];
      });
    return () => sub?.unsubscribe();
  });

  let tally = $derived(tallyPollVotes(event, responses, manager.active?.pubkey));
  let hasVoted = $derived(tally.userVote !== null);
  let showResults = $derived(hasVoted || revealed || isClosed);

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

  // Vote action — implementation deferred to Task 7.
  async function castVote() {
    // intentionally empty stub
  }
</script>

<div class="rounded-box border border-base-300 bg-base-100 p-4">
  <p data-testid="poll-question" class="text-lg font-semibold {truncate ? 'line-clamp-3' : ''}">
    {event.content}
  </p>

  <div class="mt-1 mb-3 flex flex-wrap items-center gap-2 text-xs text-base-content/70">
    <span>{pollType === 'multiplechoice' ? 'Multiple choice' : 'Single choice'}</span>
    <span aria-hidden="true">·</span>
    <span>{tally.totalVoters} voter{tally.totalVoters === 1 ? '' : 's'}</span>
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
      {:else}
        <button
          type="button"
          class="btn justify-start btn-sm {selected.includes(opt.id)
            ? 'btn-primary'
            : 'btn-outline'}"
          aria-pressed={selected.includes(opt.id)}
          onclick={() => toggleSelection(opt.id)}
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
          disabled={selected.length === 0}
          onclick={castVote}
        >
          Cast vote
        </button>
      {:else}
        <span class="text-sm text-base-content/60">Log in to vote</span>
      {/if}
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => (revealed = true)}>
        Show results without voting
      </button>
    </div>
  {/if}
</div>
