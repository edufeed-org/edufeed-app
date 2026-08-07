<!-- Captures the props ReactionChips passes to ReactionButton and exposes a
     clickable stand-in so tests can invoke the onToggle callback prop. -->
<script>
  let {
    emoji,
    count = 0,
    userReacted = false,
    userReactionEvent = null,
    emojiUrl = null,
    reactors = [],
    onToggle
  } = $props();
</script>

<button
  data-testid="reaction-button-stub"
  data-emoji={emoji}
  data-count={count}
  data-user-reacted={userReacted}
  data-user-reaction-event={userReactionEvent ? JSON.stringify(userReactionEvent) : ''}
  data-emoji-url={emojiUrl ?? ''}
  data-reactors={reactors.join(',')}
  onclick={() => onToggle?.()}
>
  {emoji}
</button>
