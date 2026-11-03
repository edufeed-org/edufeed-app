<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'QR code';
</script>

<Icon {class_} {title}>
  <rect x="4" y="4" width="6" height="6" rx="1" />
  <rect x="14" y="4" width="6" height="6" rx="1" />
  <rect x="4" y="14" width="6" height="6" rx="1" />
  <path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2h-2zM16 16h2v2h-2z" />
</Icon>
