<script>
  import ParticipantsEditor from '$lib/components/calendar/ParticipantsEditor.svelte';
  let { initial = [], cohostToggle = false } = $props();
  let participants = $state(initial);
</script>

<ParticipantsEditor bind:participants {cohostToggle} />
<pre data-testid="participants-json">{JSON.stringify(participants)}</pre>
