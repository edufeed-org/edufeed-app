<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Poll';
</script>

<Icon {class_} {title}>
  <!-- bar-chart-3 (lucide) -->
  <path d="M3 3v18h18" />
  <path d="M7 16V10" />
  <path d="M12 16V6" />
  <path d="M17 16v-4" />
</Icon>
