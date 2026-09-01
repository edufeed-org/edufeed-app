<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Star';
  /** Filled = favourited; outline = not. Same path, fill toggled. */
  export let filled = false;
</script>

<Icon {class_} {title} fill={filled ? 'currentColor' : 'none'}>
  <path
    d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
  />
</Icon>
