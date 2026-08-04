<!-- Captures the props ChannelChat passes to the real PollMessage and lets a
     test fire onVote. Render behavior is covered by PollMessage.test.js. -->
<script>
  let { poll, tally, ended, onVote } = $props();
</script>

<div
  data-testid="poll-message-stub"
  data-poll={JSON.stringify(poll)}
  data-total-voters={tally.totalVoters}
  data-ended={ended}
>
  <button data-testid="poll-vote-stub" onclick={() => onVote([poll.options[0]?.id])}>
    vote-first-option
  </button>
</div>
