<!-- Captures the meetings GroupChat hands the real MeetingBar
     (MeetingBar.test.js covers the bar itself). -->
<script>
  let { meetings, onJoin = undefined } = $props();
</script>

<div
  data-testid="meeting-bar-stub"
  data-ids={meetings.map((/** @type {any} */ e) => e.id).join(',')}
>
  {#if onJoin}
    <button data-testid="meeting-bar-stub-join" onclick={() => onJoin()}>join</button>
  {/if}
</div>
