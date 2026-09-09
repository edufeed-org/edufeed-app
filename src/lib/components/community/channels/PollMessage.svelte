<!--
  PollMessage — NIP-88 poll inside a chat bubble (NIP-29 group rooms and
  Concord channels). The poll QUESTION is the rumor's content and is rendered
  by the bubble itself (NostrContentRenderer) — this component starts below
  it and adapts the channel tally onto the shared PollBody, so chat polls use
  the same layout and flow as the community poll cards (pick → "Cast vote",
  bars + voter avatars afterwards, "Change vote" while the poll is open).

  Voting stays the caller's business: `onVote` publishes through the room's
  own transport (h-tagged group relay write / encrypted channel rumor) and
  resolves truthy on success.
-->
<script>
  import PollBody from '$lib/components/polls/PollBody.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';

  /** @type {{poll: import('$lib/concord/polls.js').ParsedPoll, tally: import('$lib/concord/polls.js').PollTally, ended: boolean, onVote: (optionIds: string[]) => (Promise<boolean | void> | boolean | void)}} */
  let { poll, tally, ended, onVote } = $props();

  // Concord tally → PollBody shape (per-option count + voter list).
  let byOption = $derived(
    new Map(
      poll.options.map((o) => [
        o.id,
        { count: tally.counts.get(o.id) ?? 0, voters: tally.voters?.get(o.id) ?? [] }
      ])
    )
  );
  let userVote = $derived(tally.myVote ? [...tally.myVote] : null);

  const getProfiles = useProfileMap(() =>
    Array.from(new Set(Array.from(byOption.values()).flatMap((s) => s.voters)))
  );
</script>

<!-- Attachment-card grammar (cf. WebxdcAttachmentCard): paper surface with
     ink text so the poll reads the same on a primary "own message" bubble. -->
<div
  data-testid="poll-message"
  class="mt-2 w-full min-w-64 rounded-lg border border-base-300 bg-base-100 p-3 text-base-content"
>
  <PollBody
    options={poll.options}
    pollType={poll.pollType}
    {byOption}
    totalVoters={tally.totalVoters}
    {userVote}
    isClosed={ended}
    endsAt={poll.endsAt ?? null}
    onCastVote={onVote}
    profiles={getProfiles()}
  />
</div>
