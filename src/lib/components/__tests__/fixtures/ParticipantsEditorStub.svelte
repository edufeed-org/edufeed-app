<!-- ParticipantsEditor stand-in: shows its label and adds two pubkeys plus a
     name-only participant on click. -->
<script>
  let { participants = $bindable([]), label = '' } = $props();
</script>

<span data-testid="participants-label">{label}</span>
<button
  type="button"
  data-testid="stub-add-participants"
  onclick={() =>
    (participants = [{ pubkey: 'b'.repeat(64) }, { pubkey: 'c'.repeat(64) }, { name: 'Erna' }])}
  >add</button
>
