<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Screen share';
</script>

<Icon {class_} {title}>
  <rect x="2" y="3" width="20" height="14" rx="2" />
  <path d="M8 21h8M12 17v4" />
  <path d="M12 13V7M9 10l3-3 3 3" />
</Icon>
