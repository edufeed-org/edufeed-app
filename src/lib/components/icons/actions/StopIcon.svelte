<!--
  StopIcon Component
  A filled square: stop a running answer
-->

<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Stop';
</script>

<Icon {class_} {title} fill="currentColor">
  <rect x="6" y="6" width="12" height="12" rx="2" />
</Icon>
