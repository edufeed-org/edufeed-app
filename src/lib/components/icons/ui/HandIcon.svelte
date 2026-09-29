<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Hand';
</script>

<Icon {class_} {title}>
  <path d="M18 11V6a2 2 0 0 0-4 0" />
  <path d="M14 10V4a2 2 0 0 0-4 0v2" />
  <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
  <path
    d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"
  />
</Icon>
