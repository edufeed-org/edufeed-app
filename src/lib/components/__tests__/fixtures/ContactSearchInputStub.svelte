<script>
  let { value = $bindable(''), onselect, onrawpubkey, exclude = [] } = $props();
  const PK_A = 'a'.repeat(64);
  const PK_B = 'b'.repeat(64);
</script>

<button data-testid="stub-select-a" onclick={() => onselect?.({ pubkey: PK_A })}>a</button>
<button data-testid="stub-select-b" onclick={() => onselect?.({ pubkey: PK_B })}>b</button>
<button data-testid="stub-raw-a" onclick={() => onrawpubkey?.(PK_A)}>raw a</button>
<div data-testid="stub-exclude">{exclude.join(',')}</div>
<div data-testid="stub-value">{value}</div>
