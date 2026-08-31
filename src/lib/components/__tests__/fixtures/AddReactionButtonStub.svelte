<!-- Captures the props ReactionChips passes to AddReactionButton: a click
     invokes onPick with a fixed emoji, and separate buttons let tests drive
     onOpenChange(true/false) to simulate the picker opening/closing. -->
<script>
  let { onPick, onOpenChange } = $props();
</script>

<button data-testid="add-reaction-btn-stub" onclick={() => onPick?.('😀')}>+</button>
<button data-testid="open-picker-stub" onclick={() => onOpenChange?.(true)}>open</button>
<button data-testid="close-picker-stub" onclick={() => onOpenChange?.(false)}>close</button>
