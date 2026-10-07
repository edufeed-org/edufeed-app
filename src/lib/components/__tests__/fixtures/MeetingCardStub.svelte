<!-- Captures what GroupChat hands the real MeetingCard (MeetingCard.test.js
     covers the card itself) and lets a test fire its join. -->
<script>
  let {
    event,
    pointer,
    user,
    isAdmin,
    onJoin = undefined,
    onEdit = undefined,
    callRunning = false
  } = $props();
</script>

<div
  data-testid="meeting-card-stub"
  data-id={event.id}
  data-group={pointer.id}
  data-user={user?.pubkey ?? ''}
  data-admin={String(isAdmin)}
  data-call-running={String(callRunning)}
>
  {#if onJoin}
    <button data-testid="meeting-card-stub-join" onclick={() => onJoin()}>join</button>
  {/if}
  {#if onEdit}
    <button data-testid="meeting-card-stub-edit" onclick={() => onEdit(event, { id: 'pass-stub' })}
      >edit</button
    >
  {/if}
</div>
