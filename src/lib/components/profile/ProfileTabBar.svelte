<!--
  ProfileTabBar — sticky, horizontally scrollable tab strip of the redesigned
  profile page. Presentational; tab list (already ordered/filtered by the
  owner's kind 30078 config) comes in via props.
-->
<script>
  /**
   * @type {{
   *   tabs: Array<{ id: string, label: string, count?: number }>,
   *   activeTab: string,
   *   onSelect: (id: string) => void
   * }}
   */
  let { tabs, activeTab, onSelect } = $props();

  /** @type {HTMLDivElement | null} */
  let strip = $state(null);
  // Edge-fade affordance: the strip scrolls with a hidden scrollbar, so on
  // narrow screens users otherwise get no hint that more tabs exist.
  let showStartFade = $state(false);
  let showEndFade = $state(false);

  function updateEdges() {
    if (!strip) return;
    showStartFade = strip.scrollLeft > 1;
    showEndFade = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
  }

  $effect(() => {
    if (!strip) return;
    updateEdges();
    // Guard: jsdom (tests) and very old browsers lack ResizeObserver — the
    // fade then only updates on scroll, which is an acceptable degradation.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateEdges) : null;
    ro?.observe(strip);
    strip.addEventListener('scroll', updateEdges, { passive: true });
    return () => {
      ro?.disconnect();
      strip?.removeEventListener('scroll', updateEdges);
    };
  });

  // Tab labels/counts stream in async and change the strip's scrollWidth
  // without resizing the strip itself — recheck when the tab list changes.
  $effect(() => {
    void tabs;
    updateEdges();
  });
</script>

<div class="pf-tabs-wrap" class:fade-start={showStartFade} class:fade-end={showEndFade}>
  <div class="pf-tabs" role="tablist" bind:this={strip}>
    {#each tabs as tab (tab.id)}
      <button
        role="tab"
        class:on={activeTab === tab.id}
        aria-selected={activeTab === tab.id}
        data-testid={`profile-tab-${tab.id}`}
        onclick={() => onSelect(tab.id)}
      >
        {tab.label}
        {#if tab.count}
          <span class="cnt">{tab.count}</span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .pf-tabs-wrap {
    position: sticky;
    top: 0;
    z-index: 30;
    background: var(--c-bg);
    border-bottom: 1px solid var(--c-rule);
    margin-top: 22px;
  }
  .pf-tabs {
    max-width: 1180px;
    margin: 0 auto;
    padding: 0 var(--pad);
    display: flex;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .pf-tabs::-webkit-scrollbar {
    display: none;
  }
  /* Scroll affordance: soft fades over the clipped edge(s). */
  .pf-tabs-wrap::before,
  .pf-tabs-wrap::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 36px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .pf-tabs-wrap::before {
    left: 0;
    background: linear-gradient(to right, var(--c-bg), transparent);
  }
  .pf-tabs-wrap::after {
    right: 0;
    background: linear-gradient(to left, var(--c-bg), transparent);
  }
  .pf-tabs-wrap.fade-start::before {
    opacity: 1;
  }
  .pf-tabs-wrap.fade-end::after {
    opacity: 1;
  }
  .pf-tabs button {
    border: 0;
    background: transparent;
    padding: 14px 13px;
    font-family: var(--pf-display);
    font-weight: 600;
    font-size: 14.5px;
    color: var(--c-ink-soft);
    cursor: pointer;
    border-bottom: 2.5px solid transparent;
    margin-bottom: -1px;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
  }
  .pf-tabs button.on {
    color: var(--c-ink);
    border-bottom-color: var(--c-band);
  }
  .pf-tabs button:hover {
    color: var(--c-ink);
  }
  .pf-tabs .cnt {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-weight: 600;
    font-size: 11px;
    opacity: 0.7;
  }
</style>
