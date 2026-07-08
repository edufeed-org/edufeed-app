<!--
  ProfileTabEditor — the owner's tab arrangement editor ("Profil anpassen"):
  drag chips to reorder, eye button to hide a tab from visitors, hidden tray
  to restore. Controlled component: reports every mutation via
  onChange(order, hidden); the page persists on "Fertig" (kind 30078).
-->
<script>
  import { EyeIcon, EyeOffIcon, GripIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   tabs: Array<{ id: string, label: string, count?: number }>,
   *   order: string[],
   *   hidden: string[],
   *   onChange: (order: string[], hidden: string[]) => void
   * }}
   */
  let { tabs, order, hidden, onChange } = $props();

  let dragId = $state(/** @type {string | null} */ (null));

  let byId = $derived(new Map(tabs.map((t) => [t.id, t])));
  let visibleIds = $derived(order.filter((id) => !hidden.includes(id)));
  let hiddenIds = $derived(order.filter((id) => hidden.includes(id)));

  /** @param {string} id */
  function toggleHidden(id) {
    const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
    onChange([...order], next);
  }

  /** @param {string} targetId */
  function dropOn(targetId) {
    if (!dragId || dragId === targetId) return;
    const next = order.filter((id) => id !== dragId);
    next.splice(next.indexOf(targetId), 0, dragId);
    onChange(next, [...hidden]);
  }
</script>

<div class="pf-tabs-edit">
  <div class="row">
    {#each visibleIds as id (id)}
      {@const tab = byId.get(id)}
      <span
        draggable="true"
        role="listitem"
        class="tab-chip"
        class:dragging={dragId === id}
        data-testid={`tab-chip-${id}`}
        ondragstart={() => (dragId = id)}
        ondragend={() => (dragId = null)}
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => {
          e.preventDefault();
          dropOn(id);
        }}
      >
        <span class="grip"><GripIcon class_="w-3.5 h-3.5" /></span>
        {tab?.label}
        {#if tab?.count}<span class="cnt">{tab.count}</span>{/if}
        <button
          class="eye"
          data-testid="toggle-hidden"
          title={m.profile_tab_hide()}
          onclick={() => toggleHidden(id)}
        >
          <EyeIcon class_="w-3.5 h-3.5" />
        </button>
      </span>
    {/each}
  </div>

  {#if hiddenIds.length > 0}
    <div class="tab-tray" data-testid="hidden-tray">
      <span class="tl">{m.profile_tabs_hidden_tray()}</span>
      {#each hiddenIds as id (id)}
        {@const tab = byId.get(id)}
        <span class="tab-chip muted" data-testid={`tab-chip-${id}`}>
          {tab?.label}
          {#if tab?.count}<span class="cnt">{tab.count}</span>{/if}
          <button
            class="eye off"
            data-testid="toggle-hidden"
            title={m.profile_tab_show()}
            onclick={() => toggleHidden(id)}
          >
            <EyeOffIcon class_="w-3.5 h-3.5" />
          </button>
        </span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .pf-tabs-edit {
    max-width: 1180px;
    margin: 0 auto;
    padding: 10px var(--pad) 14px;
  }
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .tab-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--c-paper);
    border: 1.5px solid var(--c-rule);
    border-radius: 999px;
    padding: 8px 8px 8px 12px;
    font-family: var(--pf-display);
    font-weight: 600;
    font-size: 13.5px;
    color: var(--c-ink);
    cursor: grab;
    user-select: none;
  }
  .tab-chip.dragging {
    opacity: 0.4;
  }
  .tab-chip.muted {
    opacity: 0.65;
    cursor: default;
  }
  .grip {
    color: var(--c-ink-soft);
    display: inline-flex;
    cursor: grab;
  }
  .cnt {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-weight: 600;
    font-size: 11px;
    color: var(--c-ink-soft);
  }
  .eye {
    width: 26px;
    height: 26px;
    border-radius: 999px;
    border: 0;
    background: var(--c-bg);
    color: var(--c-ink-soft);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .eye:hover {
    background: color-mix(in oklch, var(--c-bg) 80%, var(--c-ink));
    color: var(--c-ink);
  }
  .eye.off {
    background: var(--c-olive-2);
    color: var(--c-on-dark);
  }
  .tab-tray {
    margin-top: 12px;
    padding: 12px;
    border: 1.5px dashed var(--c-rule);
    border-radius: 13px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .tab-tray .tl {
    font-family: var(--pf-display);
    font-weight: 700;
    font-size: 10.5px;
    line-height: 1;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: var(--c-ink-soft);
    margin-right: 4px;
  }
</style>
