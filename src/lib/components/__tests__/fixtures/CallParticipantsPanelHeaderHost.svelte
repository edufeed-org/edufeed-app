<script>
  /** Mounts CallParticipantsPanel with a host-provided `headerExtras` snippet. */
  import CallParticipantsPanel from '$lib/components/groups/call/CallParticipantsPanel.svelte';
  let { rows } = $props();
</script>

<CallParticipantsPanel {rows} onTogglePin={() => {}} onVolumeChange={() => {}} onClose={() => {}}>
  {#snippet headerExtras()}
    <button data-testid="header-extra">rooms</button>
  {/snippet}
</CallParticipantsPanel>
