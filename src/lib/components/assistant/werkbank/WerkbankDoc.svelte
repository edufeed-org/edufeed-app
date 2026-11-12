<script>
  // The Werkbank's middle column: one part of the draft, block by block, with the
  // blocks its latest rewrite changed marked; below it the turn's sources fold.
  import * as m from '$lib/paraglide/messages';
  import { renderMarkdown } from '$lib/helpers/markdown.js';
  import { blocksOf, changedBlocks } from '$lib/termi/werkbank.js';
  import { withoutHtmlComments } from '../document-export.js';
  import { ANSWER_ACTIONS, runAnswerAction } from '../answer-actions.js';
  import ItemCards from '../cards/ItemCards.svelte';
  import { lazyComponent } from '$lib/helpers/lazy-component.svelte.js';

  const liaFrame = lazyComponent(() => import('./LiaFrame.svelte'));
  /** a module part is a course: `course` plays it in the LiaScript player */
  let view = $state('text');
  $effect(() => {
    if (key) view = 'text';
  });

  /**
   * @type {{
   *   part: import('$lib/termi/werkbank.js').WerkbankPart | null,
   *   turn: import('../history/conversation-codec.js').Turn | undefined,
   *   ctx: import('../answer-actions.js').AnswerActionCtx
   * }} `turn`: the turn that wrote the part (its sources); `ctx`: the bubbles' action context
   */
  let { part, turn, ctx } = $props();
  // by value: the window hands a new part object on every streamed token of any answer
  const key = $derived(part?.key);
  const text = $derived(part?.text ?? '');
  const prev = $derived(part?.prev);

  const HIGHLIGHT = 'bg-accent/15';
  /** A table row block: one line, a pipe row. @param {string} b */
  const isRow = (b) => !b.includes('\n') && b.trimStart().startsWith('|');

  // Rows of one table render as one table (a row alone is no table); each row keeps its own mark.
  const groups = $derived.by(() => {
    if (!key) return [];
    const changed = changedBlocks(prev, text);
    /** @type {{ md: string, changed: boolean, rows: boolean[] }[]} */
    const out = [];
    blocksOf(text).forEach((b, i) => {
      const last = out.at(-1);
      if (last && isRow(b) && last.md.trimStart().startsWith('|')) {
        last.md += '\n' + b;
        last.rows.push(changed.has(i));
      } else out.push({ md: b, changed: changed.has(i), rows: [] });
    });
    return out.map((g) => ({
      ...g,
      html: renderMarkdown(withoutHtmlComments(g.md), { allowLinks: false })
    }));
  });

  /** Marks a table's changed body rows. @param {HTMLElement} node @param {boolean[]} rows */
  function markRows(node, rows) {
    const apply = (/** @type {boolean[]} */ r) =>
      node.querySelectorAll('tbody tr').forEach((tr, i) => {
        tr.toggleAttribute('data-changed', !!r[i]);
        tr.classList.toggle(HIGHLIGHT, !!r[i]);
      });
    apply(rows);
    return { update: apply };
  }

  // the part as a turn of its own: copy and download export its text, not the whole answer
  const partTurn = $derived(part && turn ? { ...turn, text: part.text } : null);
  // a rendered turn holds Items (see AnswerBubble)
  const items = $derived(
    /** @type {import('$lib/termi/items.d.js').Item[] | undefined} */ (turn?.items)
  );
  const menu = ANSWER_ACTIONS.filter((a) => a.id === 'copy' || a.id === 'download');
</script>

<section data-testid="werkbank-doc" class="min-w-0 flex-1 overflow-y-auto bg-base-100">
  {#if part}
    <div class="mx-auto max-w-3xl px-6 py-6">
      {#if partTurn}
        {@const pt = partTurn}
        <div class="mb-3 flex justify-end gap-2" data-testid="werkbank-part-menu">
          {#each menu as action (action.id)}
            {@const state = ctx.getState(/** @type {string} */ (pt.id), action.id)}
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              data-testid="werkbank-doc-{action.id}"
              disabled={state?.busy}
              onclick={() => runAnswerAction(pt, action, ctx)}
            >
              {action.label(ctx, state)}
            </button>
          {/each}
        </div>
      {/if}
      {#if part.kind === 'module'}
        <div
          class="join mb-3"
          data-testid="werkbank-doc-course-switch"
          role="group"
          aria-label={m.termi_werkbank_view_label()}
        >
          <button
            type="button"
            class="btn join-item btn-sm {view === 'text' ? 'btn-active' : ''}"
            aria-pressed={view === 'text'}
            data-testid="werkbank-doc-text"
            onclick={() => (view = 'text')}>{m.termi_werkbank_view_text()}</button
          >
          <button
            type="button"
            class="btn join-item btn-sm {view === 'course' ? 'btn-active' : ''}"
            aria-pressed={view === 'course'}
            data-testid="werkbank-doc-course"
            onclick={() => (view = 'course')}>{m.termi_werkbank_view_course()}</button
          >
        </div>
      {/if}
      {#if part.kind === 'module' && view === 'course'}
        {@const Frame = liaFrame.Component}
        {#if Frame}<Frame markdown={text} />{/if}
      {:else}
        <article class="termi-md @container prose prose-sm max-w-none">
          {#each groups as group, i (i)}
            <div
              data-changed={group.changed || undefined}
              class="-mx-2 rounded px-2 {group.changed ? HIGHLIGHT : ''}"
              use:markRows={group.rows}
            >
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- safe: renderMarkdown allowLinks:false escapes raw HTML, drops links/images, DOMPurify -->
              {@html group.html}
            </div>
          {/each}
        </article>
      {/if}
      {#if turn?.items || turn?.sourcesUnavailable}
        <div class="mt-6">
          <ItemCards
            {items}
            sourcesUnavailable={turn.sourcesUnavailable}
            query={turn.query}
            collapsed
          />
        </div>
      {/if}
    </div>
  {:else}
    <p class="p-6 text-sm text-base-content/60">{m.termi_werkbank_doc_empty()}</p>
  {/if}
</section>
