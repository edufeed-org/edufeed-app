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
</script>

<div class="pf-tabs-wrap">
  <div class="pf-tabs" role="tablist">
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
