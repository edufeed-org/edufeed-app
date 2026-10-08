<script>
  /** Test double for LicenseModal: "saves" immediately when opened. */
  let { open = $bindable(false), onsave = undefined } = $props();
  $effect(() => {
    if (open) {
      open = false;
      onsave?.({ kind: 1063, tags: [['license', 'CC0']] });
    }
  });
</script>
