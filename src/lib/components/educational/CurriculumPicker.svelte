<!--
  CurriculumPicker — four-level cascade (Bundesland → Schulart → Schulfach →
  Lehrplan) plus a CurriculumTree for browsing topic nodes inside the chosen
  Lehrplan. Each node action emits `onadd(concept, relation)` upward; the
  three chip-list sections render the currently-selected concepts (passed in
  as props) with × buttons that emit `onremove(id, relation)`.

  The cascade selections are URIs end-to-end and live as throwaway $state.
  The form owns the persisted teaches/assesses/competencyRequired arrays.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import CurriculumTree from './CurriculumTree.svelte';
  import { CloseIcon } from '$lib/components/icons';

  /**
   * @typedef {Object} CurriculumItem
   * @property {string} id
   * @property {string} label
   */

  /**
   * @typedef {Object} Concept
   * @property {string} id
   * @property {'Concept'} type
   * @property {{ de: string }} prefLabel
   */

  /** @typedef {'teaches' | 'assesses' | 'competencyRequired'} Relation */

  /**
   * @type {{
   *   teaches?: Concept[],
   *   assesses?: Concept[],
   *   competencyRequired?: Concept[],
   *   onadd?: (concept: Concept, relation: Relation) => void,
   *   onremove?: (conceptId: string, relation: Relation) => void
   * }}
   */
  let {
    teaches = [],
    assesses = [],
    competencyRequired = [],
    onadd = () => {},
    onremove = () => {}
  } = $props();

  // Sentinel value for the "Alle Schularten" option. Many states (RP, SN, …)
  // don't tag every Lehrplan with a Schulart, so the per-Schulart filter would
  // silently hide subjects that exist. Picking this sentinel strips the
  // schulartUri arg from the downstream `list_schulfaecher` / `find_lehrplaene`
  // requests so those Lehrpläne surface again.
  const ANY_SCHULART = '__any__';

  // Cascade UI state — URIs end-to-end, throwaway, not persisted into the AMB doc.
  let bundeslandUri = $state('');
  let schulartUri = $state('');
  let schulfachUri = $state('');
  let lehrplanUri = $state('');

  let bundeslaender = $state(/** @type {CurriculumItem[]} */ ([]));
  let schularten = $state(/** @type {CurriculumItem[]} */ ([]));
  let schulfaecher = $state(/** @type {CurriculumItem[]} */ ([]));
  let lehrplaene = $state(/** @type {CurriculumItem[]} */ ([]));
  /** Direct children of the chosen Lehrplan — root nodes of the tree. */
  let rootNodes = $state(/** @type {CurriculumItem[]} */ ([]));

  // Loading flags drive the "Lade…" placeholder option in each select so users
  // see something happening while the upstream SPARQL endpoint is slow.
  let loadingBundeslaender = $state(false);
  let loadingSchularten = $state(false);
  let loadingSchulfaecher = $state(false);
  let loadingLehrplaene = $state(false);

  /**
   * POST to /api/curricula and return parsed JSON body.
   * @param {string} tool
   * @param {Record<string, unknown>} args
   */
  async function fetchTool(tool, args) {
    const res = await fetch('/api/curricula', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool, args })
    });
    if (!res.ok) throw new Error(`/api/curricula HTTP ${res.status}`);
    return res.json();
  }

  $effect(() => {
    loadingBundeslaender = true;
    fetchTool('list_bundeslaender', {})
      .then((body) => {
        bundeslaender = Array.isArray(body.items) ? body.items : [];
      })
      .catch(() => {
        bundeslaender = [];
      })
      .finally(() => {
        loadingBundeslaender = false;
      });
  });

  $effect(() => {
    const bl = bundeslandUri;
    schulartUri = '';
    schulfachUri = '';
    lehrplanUri = '';
    schularten = [];
    schulfaecher = [];
    lehrplaene = [];
    rootNodes = [];
    if (!bl) return;
    loadingSchularten = true;
    fetchTool('list_schularten', { bundeslandUri: bl })
      .then((body) => {
        schularten = Array.isArray(body.items) ? body.items : [];
      })
      .catch(() => {
        schularten = [];
      })
      .finally(() => {
        loadingSchularten = false;
      });
  });

  $effect(() => {
    const sa = schulartUri;
    const bl = bundeslandUri;
    schulfachUri = '';
    lehrplanUri = '';
    schulfaecher = [];
    lehrplaene = [];
    rootNodes = [];
    if (!sa || !bl) return;
    // ANY_SCHULART sentinel = "Alle Schularten" → omit the schulartUri arg so
    // the server skips the LP_0000812 filter.
    /** @type {{ bundeslandUri: string, schulartUri?: string }} */
    const args = { bundeslandUri: bl };
    if (sa !== ANY_SCHULART) args.schulartUri = sa;
    loadingSchulfaecher = true;
    fetchTool('list_schulfaecher', args)
      .then((body) => {
        schulfaecher = Array.isArray(body.items) ? body.items : [];
      })
      .catch(() => {
        schulfaecher = [];
      })
      .finally(() => {
        loadingSchulfaecher = false;
      });
  });

  $effect(() => {
    const sf = schulfachUri;
    const sa = schulartUri;
    const bl = bundeslandUri;
    lehrplanUri = '';
    lehrplaene = [];
    rootNodes = [];
    if (!sf || !sa || !bl) return;
    /** @type {{ bundeslandUri: string, schulfachUri: string, schulartUri?: string }} */
    const args = { bundeslandUri: bl, schulfachUri: sf };
    if (sa !== ANY_SCHULART) args.schulartUri = sa;
    loadingLehrplaene = true;
    fetchTool('find_lehrplaene', args)
      .then((body) => {
        lehrplaene = Array.isArray(body.items) ? body.items : [];
      })
      .catch(() => {
        lehrplaene = [];
      })
      .finally(() => {
        loadingLehrplaene = false;
      });
  });

  $effect(() => {
    const lp = lehrplanUri;
    rootNodes = [];
    if (!lp) return;
    fetchTool('get_node_children', { nodeUri: lp })
      .then((body) => {
        rootNodes = Array.isArray(body.items) ? body.items : [];
      })
      .catch(() => {
        rootNodes = [];
      });
  });

  /** @type {{ key: Relation, title: () => string, items: Concept[] }[]} */
  const sections = $derived([
    { key: 'teaches', title: m.curriculum_picker_section_teaches, items: teaches },
    { key: 'assesses', title: m.curriculum_picker_section_assesses, items: assesses },
    {
      key: 'competencyRequired',
      title: m.curriculum_picker_section_competency_required,
      items: competencyRequired
    }
  ]);
</script>

<div class="flex flex-col gap-3">
  <label class="form-control">
    <span class="label-text">{m.curriculum_picker_bundesland()}</span>
    <select
      class="select-bordered select w-full"
      aria-label={m.curriculum_picker_bundesland()}
      bind:value={bundeslandUri}
    >
      {#if loadingBundeslaender}
        <option value="">{m.curriculum_picker_loading()}</option>
      {:else}
        <option value="">{m.curriculum_picker_choose()}</option>
      {/if}
      {#each bundeslaender as item (item.id)}
        <option value={item.id}>{item.label}</option>
      {/each}
    </select>
  </label>

  <label class="form-control">
    <span class="label-text">{m.curriculum_picker_schulart()}</span>
    <select
      class="select-bordered select w-full"
      aria-label={m.curriculum_picker_schulart()}
      bind:value={schulartUri}
      disabled={!bundeslandUri}
    >
      {#if loadingSchularten}
        <option value="">{m.curriculum_picker_loading()}</option>
      {:else}
        <option value="">{m.curriculum_picker_choose()}</option>
        <option value={ANY_SCHULART}>{m.curriculum_picker_schulart_any()}</option>
      {/if}
      {#each schularten as item (item.id)}
        <option value={item.id}>{item.label}</option>
      {/each}
    </select>
  </label>

  <label class="form-control">
    <span class="label-text">{m.curriculum_picker_schulfach()}</span>
    <select
      class="select-bordered select w-full"
      aria-label={m.curriculum_picker_schulfach()}
      bind:value={schulfachUri}
      disabled={!schulartUri}
    >
      {#if loadingSchulfaecher}
        <option value="">{m.curriculum_picker_loading()}</option>
      {:else}
        <option value="">{m.curriculum_picker_choose()}</option>
      {/if}
      {#each schulfaecher as item (item.id)}
        <option value={item.id}>{item.label}</option>
      {/each}
    </select>
  </label>

  <label class="form-control">
    <span class="label-text">{m.curriculum_picker_lehrplan()}</span>
    <select
      class="select-bordered select w-full"
      aria-label={m.curriculum_picker_lehrplan()}
      bind:value={lehrplanUri}
      disabled={!schulfachUri}
    >
      {#if loadingLehrplaene}
        <option value="">{m.curriculum_picker_loading()}</option>
      {:else}
        <option value="">{m.curriculum_picker_choose()}</option>
      {/if}
      {#each lehrplaene as item (item.id)}
        <option value={item.id}>{item.label}</option>
      {/each}
    </select>
  </label>

  {#if lehrplanUri && rootNodes.length > 0}
    <div class="rounded-md border border-base-300 p-2">
      <div class="mb-1 text-sm font-medium">{m.curriculum_picker_topic()}</div>
      <CurriculumTree
        {rootNodes}
        selectedTeaches={teaches.map((c) => c.id)}
        selectedAssesses={assesses.map((c) => c.id)}
        selectedRequires={competencyRequired.map((c) => c.id)}
        onaction={(c, r) => onadd(c, r)}
      />
    </div>
  {/if}

  <div class="flex flex-col gap-2">
    {#each sections as section (section.key)}
      <div class="rounded-md border border-base-300 p-2">
        <div class="mb-1 text-sm font-medium">{section.title()}</div>
        {#if section.items.length === 0}
          <span class="text-xs text-base-content/60">{m.curriculum_picker_empty_section()}</span>
        {:else}
          <ul class="m-0 flex flex-wrap gap-1 p-0">
            {#each section.items as concept (concept.id)}
              <li>
                <span class="badge gap-1 py-3 badge-primary">
                  <span class="max-w-xs truncate">{concept.prefLabel?.de ?? concept.id}</span>
                  <button
                    type="button"
                    class="btn btn-circle btn-ghost btn-xs"
                    aria-label={m.curriculum_picker_remove_concept() +
                      ': ' +
                      (concept.prefLabel?.de ?? concept.id)}
                    onclick={() => onremove(concept.id, section.key)}
                  >
                    <CloseIcon class_="h-3 w-3" />
                  </button>
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}
  </div>
</div>
