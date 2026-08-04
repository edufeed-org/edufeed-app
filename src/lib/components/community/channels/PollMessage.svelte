<!--
  PollMessage — NIP-88 poll options, live tally, and vote controls inside a
  chat bubble. The poll QUESTION is the rumor's content and is rendered by
  the bubble itself (NostrContentRenderer) — this component starts below it.

  Single choice: an option row is itself the vote button (re-clicking another
  row re-votes; latest-per-pubkey wins in the tally). Multiple choice:
  checkboxes plus an explicit Vote button. An ended poll is read-only.
-->
<script>
  import { SvelteSet } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages';

  /** @type {{poll: import('$lib/concord/polls.js').ParsedPoll, tally: import('$lib/concord/polls.js').PollTally, ended: boolean, onVote: (optionIds: string[]) => void}} */
  let { poll, tally, ended, onVote } = $props();

  /** Local multi-choice selection, seeded from my prior vote. */
  const selection = new SvelteSet(tally.myVote ?? []);

  function toggle(/** @type {string} */ id) {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
  }

  function pct(/** @type {string} */ id) {
    if (!tally.totalVoters) return 0;
    return Math.round(((tally.counts.get(id) ?? 0) / tally.totalVoters) * 100);
  }
</script>

<div class="mt-2 flex w-full min-w-48 flex-col gap-1.5">
  {#each poll.options as option (option.id)}
    {@const count = tally.counts.get(option.id) ?? 0}
    {@const isMine = tally.myVote?.has(option.id) ?? false}
    {#if poll.pollType === 'singlechoice'}
      <button
        type="button"
        class="relative overflow-hidden rounded border border-base-300 px-2 py-1.5 text-left text-sm
               {ended ? 'cursor-default' : 'hover:border-primary'}"
        data-my-vote={isMine}
        disabled={ended}
        onclick={() => {
          if (!ended) onVote([option.id]);
        }}
      >
        <span
          class="absolute inset-y-0 left-0 bg-primary/15"
          style="width: {pct(option.id)}%"
          aria-hidden="true"
        ></span>
        <span class="relative flex items-center justify-between gap-2">
          <span>{isMine ? '✓ ' : ''}{option.label}</span>
          <span class="text-xs opacity-60">{count}</span>
        </span>
      </button>
    {:else}
      <label
        class="relative flex items-center gap-2 overflow-hidden rounded border border-base-300 px-2 py-1.5 text-sm"
        data-my-vote={isMine}
      >
        <span
          class="absolute inset-y-0 left-0 bg-primary/15"
          style="width: {pct(option.id)}%"
          aria-hidden="true"
        ></span>
        <input
          type="checkbox"
          class="checkbox relative checkbox-xs"
          aria-label={option.label}
          checked={selection.has(option.id)}
          disabled={ended}
          onchange={() => toggle(option.id)}
        />
        <span class="relative flex flex-1 items-center justify-between gap-2">
          <span>{option.label}</span>
          <span class="text-xs opacity-60">{count}</span>
        </span>
      </label>
    {/if}
  {/each}

  <div class="flex items-center justify-between text-xs opacity-60">
    <span>{m.concord_poll_votes({ count: tally.totalVoters })}</span>
    {#if ended}
      <span>{m.concord_poll_ended()}</span>
    {:else if poll.pollType === 'multiplechoice'}
      <button
        type="button"
        class="btn btn-xs btn-primary"
        disabled={selection.size === 0}
        onclick={() => onVote([...selection])}
      >
        {m.concord_poll_vote()}
      </button>
    {/if}
  </div>
</div>
