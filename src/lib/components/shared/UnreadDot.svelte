<script>
  import * as m from '$lib/paraglide/messages.js';

  /**
   * @type {{
   *   onclick: (e: MouseEvent) => void,
   *   ariaLabel?: string
   * }}
   */
  let { onclick, ariaLabel = m.inbox_mark_read() } = $props();
</script>

<div
  role="button"
  tabindex="-1"
  class="mt-2 h-2 w-2 flex-shrink-0 cursor-pointer rounded-full bg-primary transition-transform hover:scale-150 hover:ring-4 hover:ring-primary/20"
  aria-label={ariaLabel}
  onclick={(e) => {
    e.stopPropagation();
    e.preventDefault();
    onclick(e);
  }}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation();
      e.preventDefault();
      onclick(/** @type {any} */ (e));
    }
  }}
></div>
