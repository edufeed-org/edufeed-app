<script>
  import Icon from '../Icon.svelte';

  export let class_ = 'w-5 h-5';
  export let title = 'Social Bookmarks';
</script>

<Icon {class_} {title}>
  <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
  <path d="M15 3v4a1 1 0 001 1h3" />
  <circle cx="17" cy="17" r="4" fill="currentColor" stroke="none" />
  <path d="M15.5 17h3M17 15.5v3" stroke="white" stroke-width="1.5" stroke-linecap="round" />
</Icon>
