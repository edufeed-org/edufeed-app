<!--
  LockIcon Component
  Lock icon for security and authentication
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
    d="M8 0a4 4 0 0 1 4 4v2.05a2.5 2.5 0 0 1 2 2.45v5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 13.5v-5a2.5 2.5 0 0 1 2-2.45V4a4 4 0 0 1 4-4m0 1a3 3 0 0 0-3 3v2h6V4a3 3 0 0 0-3-3"
  />
</Icon>
