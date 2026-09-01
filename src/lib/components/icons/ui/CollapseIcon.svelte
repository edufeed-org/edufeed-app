<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Collapse';
</script>

<Icon {class_} {title}>
  <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
</Icon>
