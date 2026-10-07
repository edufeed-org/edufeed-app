<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Camera off';
</script>

<!-- VideoIcon's body and lens flap, cut where the MicOffIcon-style slash crosses. -->
<Icon {class_} {title}>
  <path d="M2 2l20 20" />
  <path d="M10.5 6H13a2 2 0 0 1 2 2v2.5" />
  <path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L17 15" />
  <path d="M3 8v8a2 2 0 0 0 2 2h8a2 2 0 0 0 1.41-.59" />
</Icon>
