<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Expand';
</script>

<Icon {class_} {title}>
  <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
</Icon>
