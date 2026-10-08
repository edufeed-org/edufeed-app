<script>
  /** Mounts CallParticipantsPanel with a host-provided `menuExtras` snippet. */
  import CallParticipantsPanel from '$lib/components/groups/call/CallParticipantsPanel.svelte';
  let { rows, onExtra } = $props();
</script>

<CallParticipantsPanel {rows} onTogglePin={() => {}} onVolumeChange={() => {}} onClose={() => {}}>
  {#snippet menuExtras(row)}
    <li>
      <button data-testid="menu-extra" onclick={() => onExtra(row.participant.identity)}>
        extra
      </button>
    </li>
  {/snippet}
</CallParticipantsPanel>
