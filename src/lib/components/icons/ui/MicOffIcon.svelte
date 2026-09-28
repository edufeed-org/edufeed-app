<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Microphone off';
</script>

<Icon {class_} {title}>
  <path d="M2 2l20 20" />
  <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
  <path d="M5 10v2a7 7 0 0 0 12 5" />
  <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
  <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
  <path d="M12 19v3" />
</Icon>
