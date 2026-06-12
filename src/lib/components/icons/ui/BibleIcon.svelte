<!--
  BibleIcon Component
  Book-with-cross glyph — used for "Bibelstelle" (Bible reference) facets.
-->

<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Bible reference';
</script>

<Icon {class_} {title} stroke="currentColor" fill="none" strokeWidth={1.8}>
  <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" />
  <path d="M4 5v14a2 2 0 0 0 2 2h13" />
  <path d="M12 7v6" />
  <path d="M9.8 9.2h4.4" />
</Icon>
