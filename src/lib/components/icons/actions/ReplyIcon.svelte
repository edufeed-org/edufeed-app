<script>
  let { class: className = 'w-5 h-5', ...props } = $props();
</script>

<svg
  class={className}
  {...props}
  xmlns="http://www.w3.org/2000/svg"
  fill="none"
  viewBox="0 0 24 24"
  stroke-width="2"
  stroke="currentColor"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <polyline points="9 17 4 12 9 7" />
  <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
</svg>
