<!--
  LockOpenIcon Component
  Open lock icon for granted access indication
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
    d="M12 0a4 4 0 0 1 4 4v2.5h-1V4a3 3 0 1 0-6 0v2h.5A2.5 2.5 0 0 1 12 8.5v5A2.5 2.5 0 0 1 9.5 16h-7A2.5 2.5 0 0 1 0 13.5v-5A2.5 2.5 0 0 1 2.5 6H8V4a4 4 0 0 1 4-4"
  />
</Icon>
