<!--
  SparkleIcon Component
  Sparkle / "Funken" glyph — used for the "Methode" extension facet.
-->

<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Method';
</script>

<Icon {class_} {title} stroke="currentColor" fill="none" strokeWidth={1.8}>
  <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
</Icon>
