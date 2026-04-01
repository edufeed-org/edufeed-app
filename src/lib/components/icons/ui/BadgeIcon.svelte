<script>
  import Icon from '../Icon.svelte';
  export let class_ = 'w-5 h-5';
  export let title = 'Badge';
</script>

<Icon {class_} {title}>
  <circle cx="12" cy="8" r="6" />
  <path d="M15.477 12.89L17 22l-5-3l-5 3l1.523-9.11" />
</Icon>
