<!--
  SchoolIcon Component
  School-building glyph — used for the "Schulart" (school type) extension facet.
-->

<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'School type';
</script>

<Icon {class_} {title} stroke="currentColor" fill="none" strokeWidth={1.8}>
  <path d="M3 21V10l4-3V4h10v3l4 3v11" />
  <path d="M3 21h18" />
  <path d="M10 21v-4a2 2 0 0 1 4 0v4" />
  <path d="M12 7v3" />
  <path d="M10.5 8.5h3" />
</Icon>
