<script>
  let { openOverlay, channelCount } = $props();
</script>

<div data-testid="stub-channel-count">{channelCount}</div>
<button data-testid="stub-open-delete-channel" onclick={() => openOverlay('delete-channel')}
  >del</button
>
<button data-testid="stub-open-dissolve" onclick={() => openOverlay('dissolve')}>dis</button>
<button data-testid="stub-open-create" onclick={() => openOverlay('create')}>create</button>
