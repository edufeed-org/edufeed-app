<script>
  let { value = $bindable(''), onselect, onrawpubkey, onrawname, exclude = [] } = $props();
  const PK_A = 'a'.repeat(64);
  const PK_B = 'b'.repeat(64);
</script>

<button data-testid="stub-select-a" onclick={() => onselect?.({ pubkey: PK_A })}>a</button>
<button data-testid="stub-select-b" onclick={() => onselect?.({ pubkey: PK_B })}>b</button>
<button data-testid="stub-raw-a" onclick={() => onrawpubkey?.(PK_A)}>raw a</button>
<button data-testid="stub-name-markus" onclick={() => onrawname?.('Markus Mustermann')}>
  name markus
</button>
<button data-testid="stub-name-markus-lower" onclick={() => onrawname?.('markus mustermann')}>
  name markus lower
</button>
<div data-testid="stub-exclude">{exclude.join(',')}</div>
<div data-testid="stub-value">{value}</div>
