<!--
  HoverCard Component
  Generic hover-triggered popover using Svelte 5 snippets.
  Shows content on hover (desktop) or tap (mobile).
-->

<script>
  import { onMount } from 'svelte';

  /**
   * @typedef {Object} Props
   * @property {import('svelte').Snippet} trigger - Trigger content snippet
   * @property {import('svelte').Snippet} content - Popover content snippet
   * @property {number} [enterDelay] - Delay before showing (ms)
   * @property {number} [leaveDelay] - Delay before hiding (ms)
   * @property {'top' | 'bottom'} [position] - Popover position
   */

  /** @type {Props} */
  let { trigger, content, enterDelay = 150, leaveDelay = 300, position = 'bottom' } = $props();

  let isOpen = $state(false);

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let enterTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let leaveTimer;
  /** @type {HTMLDivElement | undefined} */
  let wrapperEl;

  function clearTimers() {
    if (enterTimer) clearTimeout(enterTimer);
    if (leaveTimer) clearTimeout(leaveTimer);
    enterTimer = undefined;
    leaveTimer = undefined;
  }

  function handleMouseEnter() {
    clearTimers();
    enterTimer = setTimeout(() => {
      isOpen = true;
    }, enterDelay);
  }

  function handleMouseLeave() {
    clearTimers();
    leaveTimer = setTimeout(() => {
      isOpen = false;
    }, leaveDelay);
  }

  function handleClick() {
    clearTimers();
    isOpen = !isOpen;
  }

  function handleKeyDown(/** @type {KeyboardEvent} */ e) {
    if (e.key === 'Escape' && isOpen) {
      isOpen = false;
    }
  }

  /** @param {PointerEvent} e */
  function handleClickOutside(e) {
    if (isOpen && wrapperEl && !wrapperEl.contains(/** @type {Node} */ (e.target))) {
      isOpen = false;
    }
  }

  onMount(() => {
    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      clearTimers();
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  });
</script>

<div
  class="relative inline-block"
  bind:this={wrapperEl}
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  onclick={handleClick}
  onkeydown={handleKeyDown}
  aria-haspopup="true"
  aria-expanded={isOpen}
  role="button"
  tabindex="0"
>
  {@render trigger()}

  {#if isOpen}
    <div
      class="absolute z-50 rounded-lg border border-base-300 bg-base-100 shadow-xl {position ===
      'top'
        ? 'bottom-full mb-2'
        : 'top-full mt-2'}"
      role="tooltip"
    >
      {@render content()}
    </div>
  {/if}
</div>
