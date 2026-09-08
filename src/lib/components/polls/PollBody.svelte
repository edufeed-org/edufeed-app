<!--
  PollBody — the shared NIP-88 poll layout below the question: meta line
  (type · voters · you voted · closed/ends), selectable option buttons before
  voting, percentage bars with voter avatars afterwards, and the vote actions.

  Purely presentational so every surface renders polls the same way:
  PollCard (community sections, feeds, detail page) feeds it a tally folded
  from kind-1018 events and votes via the outbox; PollMessage (NIP-29 group
  chat, Concord channels) feeds it the channel tally and votes through the
  room's own transport. Selection / reveal state lives here; the caller only
  learns the chosen option ids through `onCastVote`.
-->
<script>
  import { getDisplayName } from 'applesauce-core/helpers';
  import * as m from '$lib/paraglide/messages.js';
  import { resolve } from '$app/paths';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import HoverCard from '$lib/components/shared/HoverCard.svelte';
  import { profileLink } from '$lib/helpers/nostrUtils.js';

  /**
   * @typedef {{id: string, label: string}} PollOption
   * @typedef {{count: number, voters: string[]}} OptionTally
   */

  /**
   * @typedef {Object} Props
   * @property {PollOption[]} options
   * @property {'singlechoice' | 'multiplechoice'} pollType
   * @property {Map<string, OptionTally>} byOption - per-option count + voter pubkeys
   * @property {number} totalVoters
   * @property {string[] | null} userVote - the viewer's current vote, null when they have not voted
   * @property {boolean} isClosed
   * @property {number | null} endsAt - unix seconds, null when the poll never closes
   * @property {boolean} [canVote] - false renders a "log in" hint instead of the vote button
   * @property {(optionIds: string[]) => (Promise<boolean | void> | boolean | void)} onCastVote - resolve truthy on success to clear the selection
   * @property {Map<string, any>} [profiles] - kind-0 contents keyed by pubkey, for voter avatars
   */
  /** @type {Props} */
  let {
    options,
    pollType,
    byOption,
    totalVoters,
    userVote,
    isClosed,
    endsAt,
    canVote = true,
    onCastVote,
    profiles = new Map()
  } = $props();

  /** @type {string[]} */
  let selected = $state([]);
  let revealed = $state(false);
  let changing = $state(false);
  let submitting = $state(false);

  let hasVoted = $derived(userVote !== null);
  let showResults = $derived(isClosed || revealed || (hasVoted && !changing));

  /** @param {Event} e */
  function stop(e) {
    e.stopPropagation();
  }

  function toggleSelection(/** @type {string} */ id) {
    if (pollType === 'multiplechoice') {
      selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    } else {
      selected = [id];
    }
  }

  function startChange() {
    selected = [...(userVote ?? [])];
    revealed = false;
    changing = true;
  }

  function cancelChange() {
    selected = [];
    changing = false;
  }

  async function castVote() {
    if (submitting || selected.length === 0) return;
    submitting = true;
    try {
      const ok = await onCastVote([...selected]);
      if (ok) {
        selected = [];
        changing = false;
      }
    } finally {
      submitting = false;
    }
  }

  function pct(/** @type {number} */ count) {
    if (!totalVoters) return 0;
    return Math.round((count / totalVoters) * 100);
  }

  function formatEndsAt(/** @type {number} */ ts) {
    try {
      return new Date(ts * 1000).toLocaleString();
    } catch {
      return String(ts);
    }
  }
</script>

<div class="mt-1 mb-3 flex flex-wrap items-center gap-2 text-xs text-base-content/70">
  <span>{pollType === 'multiplechoice' ? m.poll_type_multiple() : m.poll_type_single()}</span>
  <span aria-hidden="true">·</span>
  <span>
    {totalVoters === 1
      ? m.poll_voter_count_one()
      : m.poll_voter_count_other({ count: totalVoters })}
  </span>
  {#if hasVoted}
    <span aria-hidden="true">·</span>
    <span class="badge badge-sm badge-success" data-testid="poll-you-voted"
      >{m.poll_you_voted()}</span
    >
  {/if}
  {#if isClosed}
    <span aria-hidden="true">·</span>
    <span class="badge badge-ghost badge-sm">{m.poll_closed()}</span>
  {:else if endsAt !== null}
    <span aria-hidden="true">·</span>
    <span>{m.poll_ends_at({ date: formatEndsAt(endsAt) })}</span>
  {/if}
</div>

<div class="flex flex-col gap-2">
  {#each options as opt (opt.id)}
    {@const slot = byOption.get(opt.id)}
    {@const count = slot?.count ?? 0}
    {@const userPicked = userVote?.includes(opt.id) ?? false}
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
                          href={resolve(profileLink(voterPubkey))}
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
        class="btn justify-start btn-sm {selected.includes(opt.id) ? 'btn-primary' : 'btn-outline'}"
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

{#if !showResults}
  <div class="mt-3 flex flex-wrap items-center gap-2">
    {#if canVote}
      <button
        type="button"
        class="btn btn-sm btn-primary"
        disabled={selected.length === 0 || submitting}
        onclick={(e) => {
          e.stopPropagation();
          castVote();
        }}
      >
        {m.poll_cast_vote()}
      </button>
    {:else}
      <span class="text-sm text-base-content/60">{m.poll_login_to_vote()}</span>
    {/if}
    {#if changing}
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        onclick={(e) => {
          e.stopPropagation();
          cancelChange();
        }}
      >
        {m.poll_change_vote_cancel()}
      </button>
    {:else}
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        onclick={(e) => {
          e.stopPropagation();
          revealed = true;
        }}
      >
        {m.poll_show_results()}
      </button>
    {/if}
  </div>
{:else if !isClosed && (!hasVoted || canVote)}
  <div class="mt-3 flex flex-wrap items-center gap-2">
    {#if !hasVoted}
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        onclick={(e) => {
          e.stopPropagation();
          revealed = false;
        }}
      >
        {m.poll_back_to_vote()}
      </button>
    {:else}
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        onclick={(e) => {
          e.stopPropagation();
          startChange();
        }}
      >
        {m.poll_change_vote()}
      </button>
    {/if}
  </div>
{/if}
