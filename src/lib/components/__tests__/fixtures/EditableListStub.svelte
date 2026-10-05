<!-- EditableList stand-in: marks where the list renders, exposes its items
     and lets a test add one ("stub-add-<itemType>" adds "#Neu"). -->
<script>
  let { label = '', items = $bindable([]), itemType = '', normalize = null } = $props();
</script>

<span data-testid="editable-list" data-item-type={itemType} data-items={JSON.stringify(items)}
  >{label}</span
>
<button
  type="button"
  data-testid={`stub-add-${itemType}`}
  onclick={() => (items = [...items, normalize ? normalize('#Neu') : '#Neu'])}>add</button
>
