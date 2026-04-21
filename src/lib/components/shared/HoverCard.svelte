<!--
  HoverCard Component
  Generic hover-triggered popover using Svelte 5 snippets.
  Shows content on hover (desktop) or tap (mobile).
-->

<script>
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';

  /**
   * @typedef {Object} Props
   * @property {import('svelte').Snippet} trigger - Trigger content snippet
   * @property {import('svelte').Snippet} content - Popover content snippet
   * @property {number} [enterDelay] - Delay before showing (ms)
   * @property {number} [leaveDelay] - Delay before hiding (ms)
   * @property {'top' | 'bottom'} [position] - Popover position
   * @property {boolean} [fixed] - Use fixed positioning to escape overflow ancestors
   */

  /** @type {Props} */
  let {
    trigger,
    content,
    enterDelay = 150,
    leaveDelay = 300,
    position = 'bottom',
    fixed = false
  } = $props();

  let isOpen = $state(false);
  let popupX = $state(0);
  let popupY = $state(0);

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let enterTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let leaveTimer;
  /** @type {HTMLDivElement | undefined} */
  let wrapperEl;
  /** @type {HTMLDivElement | undefined} */
  let triggerEl;

  function clearTimers() {
    if (enterTimer) clearTimeout(enterTimer);
    if (leaveTimer) clearTimeout(leaveTimer);
    enterTimer = undefined;
    leaveTimer = undefined;
  }

  function updateFixedPosition() {
    if (!fixed || !triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const popupWidth = 288; // w-72 = 18rem
    popupX = Math.min(rect.left, window.innerWidth - popupWidth - 16);
    if (position === 'top') {
      popupY = window.innerHeight - rect.top + 8;
    } else {
      popupY = rect.bottom + 8;
    }
  }

  function handleMouseEnter() {
    clearTimers();
    enterTimer = setTimeout(() => {
      updateFixedPosition();
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
    if (!isOpen) updateFixedPosition();
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
  <div bind:this={triggerEl} class="inline-block">
    {@render trigger()}
  </div>

  {#if isOpen}
    <div
      class="not-prose z-50 rounded-lg border border-base-300 bg-base-100 shadow-xl"
      class:absolute={!fixed}
      class:fixed
      class:bottom-full={!fixed && position === 'top'}
      class:mb-2={!fixed && position === 'top'}
      class:top-full={!fixed && position !== 'top'}
      class:mt-2={!fixed && position !== 'top'}
      style={fixed
        ? `left:${popupX}px;${position === 'top' ? 'bottom' : 'top'}:${popupY}px;min-width:16rem;`
        : ''}
      role="tooltip"
      transition:fade={{ duration: 150 }}
    >
      {@render content()}
    </div>
  {/if}
</div>
