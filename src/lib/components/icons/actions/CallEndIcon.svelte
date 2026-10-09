<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'End call';
</script>

<!-- A handset laid down (phone rotated to hang up), Lucide "phone-off" lines. -->
<Icon {class_} {title}>
  <path
    d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92V20a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-2.67M6.6 9.9A19.79 19.79 0 014.1 4.18 2 2 0 016.08 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L10.1 9.9"
  />
  <path d="M22 2L2 22" />
</Icon>
