<!--
  ScrollToTopButton — Fixed button that appears after scrolling down,
  smoothly scrolls to the top of the page on click.
  Uses document-level capture to detect scrolling from any container.
-->

<script>
  import { browser } from '$app/environment';
  import { ChevronUpIcon } from '$lib/components/icons';

  const SCROLL_THRESHOLD = 400;

  let visible = $state(false);

  /** @type {Element | null} */
  let lastScrolledElement = null;

  $effect(() => {
    if (!browser) return;

    /**
     * Capture-phase scroll handler: fires for window scroll AND inner containers.
     * @param {Event} e
     */
    function onScroll(e) {
      const target = e.target;
      if (target === document || target === document.documentElement) {
        // Window-level scroll
        lastScrolledElement = null;
        visible = window.scrollY > SCROLL_THRESHOLD;
      } else if (target instanceof Element) {
        // Inner container scroll
        lastScrolledElement = target;
        visible = target.scrollTop > SCROLL_THRESHOLD;
      }
    }

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  });

  function scrollToTop() {
    const target = lastScrolledElement || window;
    target.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

{#if visible}
  <button
    class="btn fixed right-6 bottom-[9.25rem] z-40 btn-circle bg-base-200 shadow-lg btn-ghost btn-sm lg:right-8 lg:bottom-[5.75rem]"
    onclick={scrollToTop}
    aria-label="Scroll to top"
  >
    <ChevronUpIcon class_="w-5 h-5" />
  </button>
{/if}
