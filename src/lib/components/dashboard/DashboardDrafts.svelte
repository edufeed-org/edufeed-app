<!--
  DashboardDrafts — Termi Werkbank drafts (lesson series, documents) of the logged-in user.
  Read-only over the local copy Termi keeps; each row is a link that opens the draft in Termi.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { termiLauncher } from '$lib/stores/termi-launcher.svelte.js';
  import { draftSummary, isDraft } from '$lib/termi/werkbank.js';
  import { draftLabel } from '../assistant/history/draft-label.js';

  /** @type {{ pubkey?: string }} */
  let { pubkey } = $props();

  let drafts = $state.raw(
    /** @type {Array<{ id: string, updatedAt: number, summary: import('$lib/termi/werkbank.js').DraftSummary }>} */ ([])
  );

  // The store module pulls the publish stack in: load it only when the block can show.
  // shortcut: reads this device's copy, so drafts made elsewhere appear once Termi synced here; re-reads when the window closes.
  $effect(() => {
    const pk = pubkey;
    void termiLauncher.open;
    if (!pk || !runtimeConfig.termi?.llm) {
      drafts = [];
      return;
    }
    let stale = false;
    import('../assistant/history/conversation-store.svelte.js').then(
      ({ readLocalConversations }) => {
        if (stale) return;
        drafts = readLocalConversations(pk, globalThis.localStorage)
          .filter(isDraft)
          .toSorted((a, b) => b.updatedAt - a.updatedAt)
          .map((c) => ({ id: c.id, updatedAt: c.updatedAt, summary: draftSummary(c) }));
      }
    );
    return () => (stale = true);
  });
</script>

{#if pubkey && runtimeConfig.termi?.llm && drafts.length}
  <section data-testid="dashboard-drafts" class="mb-4">
    <h3 class="mb-2 text-sm font-semibold">{m.termi_werkbank_drafts()}</h3>
    <ul class="flex flex-col gap-1">
      {#each drafts as d (d.id)}
        <li>
          <a
            href="?termi={d.id}"
            class="flex flex-wrap items-baseline gap-x-2 rounded-xl bg-base-100 px-3 py-2 hover:bg-base-200"
          >
            <span class="font-semibold">{d.summary.title || '…'}</span>
            <span class="text-xs text-base-content/60">
              {draftLabel(d.summary)}
              {#if d.summary.published}
                · <span class="badge badge-ghost badge-sm"
                  >{m.termi_werkbank_draft_published()}</span
                >
              {/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/if}
