<!--
  ChannelsIcon — two overlapping speech bubbles: a community's channels
  (design 1a, laoc 2026-10-02). Not the lock: in the channel list the lock
  already means "private channel".
-->
<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Channels';
</script>

<Icon {class_} {title}>
  <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
  <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
</Icon>
