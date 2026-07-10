<script>
  import ParticipantsEditor from '$lib/components/calendar/ParticipantsEditor.svelte';
  let { initial = [] } = $props();
  let participants = $state(initial);
</script>

<ParticipantsEditor bind:participants />
<pre data-testid="participants-json">{JSON.stringify(participants)}</pre>
