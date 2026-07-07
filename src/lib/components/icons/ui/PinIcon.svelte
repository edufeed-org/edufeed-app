<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Pin';
</script>

<Icon {class_} {title}>
  <path d="M9 4h6l-.7 6.2 2.7 2.3v1.5H7v-1.5l2.7-2.3L9 4Z" />
  <path d="M12 14v6" />
</Icon>
