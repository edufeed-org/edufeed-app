<!--
  BotIcon Component
  Robot head icon for AI agents
-->

<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  // Decorative by default — a non-empty default leaks an English SVG
  // <title> tooltip OVER the caller's translated wrapper title.
  export let title = '';
</script>

<Icon {class_} {title} viewBox="0 0 16 16" fill="currentColor" stroke="none" strokeWidth={0}>
  <path
    d="M8 0a1 1 0 0 1 1 1v1h2.5A2.5 2.5 0 0 1 14 4.5v6a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 10.5v-6A2.5 2.5 0 0 1 4.5 2H7V1a1 1 0 0 1 1-1M4.5 3A1.5 1.5 0 0 0 3 4.5v6A1.5 1.5 0 0 0 4.5 12h7a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 11.5 3zM6 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2m4 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2M5.5 9.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1M0 6.5a1 1 0 0 1 1-1v3a1 1 0 0 1-1-1zm16 0v1a1 1 0 0 1-1 1v-3a1 1 0 0 1 1 1"
  />
</Icon>
