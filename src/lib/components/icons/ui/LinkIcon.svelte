<!--
  LinkIcon Component
  Chain-link icon for hyperlinks / external references
-->

<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Link';
</script>

<Icon {class_} {title}>
  <path
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width="2"
    d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5"
  />
</Icon>
