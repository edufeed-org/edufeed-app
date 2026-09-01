<script>
  // Stand-in for CommunitySelector that just exposes the current selection,
  // so modal tests can assert which communities are pre-selected.
  let { communities = [], selectedCommunityIds = $bindable([]) } = $props();
</script>

<div data-testid="selected-communities">{selectedCommunityIds.join(',')}</div>
<div data-testid="available-communities">{communities.join(',')}</div>
