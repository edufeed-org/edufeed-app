<!--
  LightbulbIcon Component
  Lightbulb glyph — used for the "Didaktisches Konzept" extension facet.
-->

<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Didactic concept';
</script>

<Icon {class_} {title} stroke="currentColor" fill="none" strokeWidth={1.8}>
  <path d="M9 18h6" />
  <path d="M10 21h4" />
  <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z" />
</Icon>
