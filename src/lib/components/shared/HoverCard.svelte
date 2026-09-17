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
   * @property {string} [class] - Classes for the wrapper (replaces the default
   *   `relative inline-block`; pass positioning/background classes here to make
   *   the whole wrapper the visible trigger, e.g. a badge)
   * @property {string} [triggerClass] - Classes for the inner trigger box
   *   (default `inline-block`; use `contents` to let the wrapper lay out the
   *   trigger's children directly)
   * @property {boolean} [stopPropagation] - Stop the toggling click / Enter /
   *   Space from bubbling, for triggers that sit inside a clickable card
   *   (otherwise the card's own click handler would navigate away)
   */

  /** @type {Props} */
  let {
    trigger,
    content,
    enterDelay = 150,
    leaveDelay = 300,
    position = 'bottom',
    fixed = false,
    class: klass = 'relative inline-block',
    triggerClass = 'inline-block',
    stopPropagation = false
  } = $props();

  let isOpen = $state(false);
  let popupX = $state(0);
  let popupY = $state(0);
  // Resolved side for fixed mode: a 'top' popover near the viewport top flips
  // below the trigger so it stays on screen.
  let placement = $state(position);

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let enterTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let leaveTimer;
  /** @type {HTMLDivElement | undefined} */
  let wrapperEl;
  /** @type {HTMLDivElement | undefined} */
  let popupEl = $state();

  function clearTimers() {
    if (enterTimer) clearTimeout(enterTimer);
    if (leaveTimer) clearTimeout(leaveTimer);
    enterTimer = undefined;
    leaveTimer = undefined;
  }

  function updateFixedPosition() {
    if (!fixed || !wrapperEl) return;
    // The wrapper box equals the trigger box (the popup is out of flow), and
    // stays measurable even when the trigger box is `display: contents`.
    const rect = wrapperEl.getBoundingClientRect();
    const popupWidth = 288; // w-72 = 18rem
    const minTopRoom = 240;
    popupX = Math.min(rect.left, window.innerWidth - popupWidth - 16);
    placement = position === 'top' && rect.top < minTopRoom ? 'bottom' : position;
    if (placement === 'top') {
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

  /** @param {Event} [e] */
  function handleClick(e) {
    if (stopPropagation) e?.stopPropagation();
    clearTimers();
    if (!isOpen) updateFixedPosition();
    isOpen = !isOpen;
  }

  function handleKeyDown(/** @type {KeyboardEvent} */ e) {
    if (e.key === 'Escape' && isOpen) {
      isOpen = false;
      return;
    }
    // Keyboard users toggle from the focused wrapper itself; a focused link or
    // button inside the trigger keeps its own Enter/Space semantics.
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      handleClick(e);
    }
  }

  /** @param {PointerEvent} e */
  function handleClickOutside(e) {
    if (!isOpen) return;
    const target = /** @type {Node} */ (e.target);
    const insideWrapper = wrapperEl?.contains(target);
    const insidePopup = popupEl?.contains(target);
    if (!insideWrapper && !insidePopup) {
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

  /**
   * Find the Svelte app root: the element directly under <body> that contains
   * `node`. Portaling here (instead of <body>) escapes ancestor `overflow`
   * clipping just the same — the app root is `display: contents` with no box —
   * while keeping the node inside Svelte 5's event-delegation root. A plain
   * document.body.appendChild moves the node OUT of the app root, which
   * silently kills delegated onclick handlers on portaled content.
   *
   * @param {HTMLElement} node
   * @returns {HTMLElement}
   */
  function getPortalTarget(node) {
    let el = node.parentElement;
    while (el && el.parentElement && el.parentElement !== document.body) {
      el = el.parentElement;
    }
    return el && el.parentElement === document.body ? el : document.body;
  }

  /**
   * Mount the popover into the app root when active so that ancestor
   * `overflow: auto` (e.g. inside a modal-box) does not clip it or, in
   * modern browsers, capture it as the containing block for `position:
   * fixed`. The position math already uses viewport coordinates via
   * getBoundingClientRect, so a portaled fixed popover lands at the
   * correct viewport-relative location.
   *
   * @param {HTMLElement} node
   * @param {boolean} active
   */
  function portal(node, active) {
    /** @type {HTMLElement | null} */
    let originalParent = null;
    /** @type {Node | null} */
    let originalNext = null;
    function mount() {
      const target = getPortalTarget(node);
      if (node.parentElement === target) return;
      originalParent = node.parentElement;
      originalNext = node.nextSibling;
      target.appendChild(node);
    }
    function unmount() {
      if (originalParent && document.body.contains(node)) {
        originalParent.insertBefore(node, originalNext);
      }
      originalParent = originalNext = null;
    }
    if (active) mount();
    return {
      /** @param {boolean} next */
      update(next) {
        if (next) mount();
        else if (originalParent) unmount();
      },
      destroy() {
        unmount();
      }
    };
  }
</script>

<div
  class={klass}
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
  <div class={triggerClass}>
    {@render trigger()}
  </div>

  {#if isOpen}
    <div
      bind:this={popupEl}
      class="not-prose rounded-lg border border-base-300 bg-base-100 shadow-xl"
      class:z-50={!fixed}
      class:z-[1000]={fixed}
      class:absolute={!fixed}
      class:fixed
      class:bottom-full={!fixed && position === 'top'}
      class:mb-2={!fixed && position === 'top'}
      class:top-full={!fixed && position !== 'top'}
      class:mt-2={!fixed && position !== 'top'}
      style={fixed
        ? `left:${popupX}px;${placement === 'top' ? 'bottom' : 'top'}:${popupY}px;min-width:16rem;`
        : ''}
      role="tooltip"
      transition:fade={{ duration: 150 }}
      use:portal={fixed}
      onmouseenter={fixed ? handleMouseEnter : undefined}
      onmouseleave={fixed ? handleMouseLeave : undefined}
    >
      {@render content()}
    </div>
  {/if}
</div>
