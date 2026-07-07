<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Drag';
</script>

<Icon {class_} {title} fill="currentColor" stroke="none">
  <circle cx="9" cy="6" r="1.5" />
  <circle cx="15" cy="6" r="1.5" />
  <circle cx="9" cy="12" r="1.5" />
  <circle cx="15" cy="12" r="1.5" />
  <circle cx="9" cy="18" r="1.5" />
  <circle cx="15" cy="18" r="1.5" />
</Icon>
