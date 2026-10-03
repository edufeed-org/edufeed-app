<!--
  DownloadIcon Component
  Tray with a downward arrow, for "save as file" actions
-->

<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Download';
</script>

<Icon {class_} {title}>
  <path
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width="2"
    d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v11m0 0l-4-4m4 4l4-4"
  />
</Icon>
