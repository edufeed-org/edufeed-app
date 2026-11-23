<script>
  let { open = $bindable(false), onpick = () => {} } = $props();
</script>

{#if open}
  <button
    data-testid="stub-pick"
    onclick={() =>
      onpick({ url: 'https://blossom.example/abc.jpg', hash: 'abc', licenseEvent: { id: 'lic1' } })}
    >pick</button
  >
{/if}
