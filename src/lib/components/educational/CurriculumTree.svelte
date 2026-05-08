<!--
  CurriculumTree — recursive lazy-loading tree of Lehrplan topic nodes.

  Given an initial flat list of root nodes, fetches each subtree on demand
  via POST /api/curricula { tool: 'get_node_children', args: { nodeUri } }.
  Each node renders its label plus three small action buttons that emit
  `onaction(concept, relation)` upward — the parent picker decides what to
  do with the SKOS Concept (typically: append to formData.{teaches,
  assesses, competencyRequired}).
-->
<script>
  import { ChevronRightIcon, ChevronDownIcon } from '$lib/components/icons';
  import { SvelteSet, SvelteMap } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages';
  import Self from './CurriculumTree.svelte';

  /**
   * @typedef {Object} TreeNode
   * @property {string} id
   * @property {string} label
   * @property {boolean} [hasChildren] When provided by the API, lets us
   *   render a leaf glyph up-front instead of a misleading expand chevron.
   *   Absent → unknown (chevron stays, fetch-on-click resolves it).
   */

  /**
   * @typedef {Object} Concept
   * @property {string} id
   * @property {'Concept'} type
   * @property {{ de: string }} prefLabel
   */

  /** @typedef {'teaches' | 'assesses' | 'competencyRequired'} Relation */

  /**
   * Selected sets are passed in as plain arrays of concept ids, so the tree
   * can mark each `+T`/`+A`/`+R` button as already-applied for that node.
   *
   * @type {{
   *   rootNodes: TreeNode[],
   *   selectedTeaches?: string[],
   *   selectedAssesses?: string[],
   *   selectedRequires?: string[],
   *   onaction?: (concept: Concept, relation: Relation) => void
   * }}
   */
  let {
    rootNodes,
    selectedTeaches = [],
    selectedAssesses = [],
    selectedRequires = [],
    onaction = () => {}
  } = $props();

  /** Per-node URI: is this node currently expanded? */
  const expanded = new SvelteSet();
  /** Per-node URI: have we attempted to fetch children yet? */
  const fetched = new SvelteSet();
  /** Per-node URI: children fetched from the API (empty array = leaf). */
  const childrenByParent = new SvelteMap();
  /** Per-node URI: is a fetch currently in flight? */
  const loadingByParent = new SvelteSet();

  /**
   * @param {TreeNode} node
   * @returns {Concept}
   */
  function nodeToConcept(node) {
    return { id: node.id, type: 'Concept', prefLabel: { de: node.label } };
  }

  /**
   * Toggle expand/collapse. On first expand, fetch children.
   * @param {TreeNode} node
   */
  async function toggle(node) {
    if (expanded.has(node.id)) {
      expanded.delete(node.id);
      return;
    }
    expanded.add(node.id);
    if (fetched.has(node.id) || loadingByParent.has(node.id)) return;
    loadingByParent.add(node.id);
    try {
      const res = await fetch('/api/curricula', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: 'get_node_children', args: { nodeUri: node.id } })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const items = Array.isArray(body.items) ? body.items : [];
      childrenByParent.set(node.id, items);
    } catch {
      childrenByParent.set(node.id, []);
    } finally {
      fetched.add(node.id);
      loadingByParent.delete(node.id);
    }
  }
</script>

<ul class="m-0 list-none p-0">
  {#each rootNodes as node (node.id)}
    {@const isOpen = expanded.has(node.id)}
    {@const isLoading = loadingByParent.has(node.id)}
    {@const children = childrenByParent.get(node.id)}
    {@const isKnownLeaf =
      node.hasChildren === false || (fetched.has(node.id) && children?.length === 0)}
    {@const inTeaches = selectedTeaches.includes(node.id)}
    {@const inAssesses = selectedAssesses.includes(node.id)}
    {@const inRequires = selectedRequires.includes(node.id)}
    <li class="border-b border-base-300/40 py-1 last:border-b-0">
      <div class="flex items-start gap-2">
        {#if isKnownLeaf}
          <span
            class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center text-base-content/40"
            aria-hidden="true"
          >
            •
          </span>
        {:else}
          <button
            type="button"
            class="btn mt-0.5 px-1 btn-ghost btn-xs"
            aria-label={(isOpen
              ? m.curriculum_picker_collapse_node()
              : m.curriculum_picker_expand_node()) +
              ': ' +
              node.label}
            aria-expanded={isOpen}
            onclick={() => toggle(node)}
          >
            {#if isOpen}
              <ChevronDownIcon class_="h-4 w-4" />
            {:else}
              <ChevronRightIcon class_="h-4 w-4" />
            {/if}
          </button>
        {/if}
        <span class="min-w-0 flex-1 text-sm break-words">{node.label}</span>
        <div class="flex shrink-0 gap-1">
          <button
            type="button"
            class="btn btn-xs {inTeaches ? 'btn-primary' : 'btn-ghost'}"
            aria-label={m.curriculum_picker_add_to_teaches() + ': ' + node.label}
            aria-pressed={inTeaches}
            title={m.curriculum_picker_add_to_teaches()}
            onclick={() => onaction(nodeToConcept(node), 'teaches')}
          >
            +T
          </button>
          <button
            type="button"
            class="btn btn-xs {inAssesses ? 'btn-primary' : 'btn-ghost'}"
            aria-label={m.curriculum_picker_add_to_assesses() + ': ' + node.label}
            aria-pressed={inAssesses}
            title={m.curriculum_picker_add_to_assesses()}
            onclick={() => onaction(nodeToConcept(node), 'assesses')}
          >
            +A
          </button>
          <button
            type="button"
            class="btn btn-xs {inRequires ? 'btn-primary' : 'btn-ghost'}"
            aria-label={m.curriculum_picker_add_to_competency_required() + ': ' + node.label}
            aria-pressed={inRequires}
            title={m.curriculum_picker_add_to_competency_required()}
            onclick={() => onaction(nodeToConcept(node), 'competencyRequired')}
          >
            +R
          </button>
        </div>
      </div>
      {#if isOpen && !isKnownLeaf}
        <div class="mt-1 ml-6">
          {#if isLoading}
            <span class="text-xs text-base-content/60">{m.curriculum_picker_loading()}</span>
          {:else if children && children.length > 0}
            <Self
              rootNodes={children}
              {selectedTeaches}
              {selectedAssesses}
              {selectedRequires}
              {onaction}
            />
          {/if}
        </div>
      {/if}
    </li>
  {/each}
</ul>
