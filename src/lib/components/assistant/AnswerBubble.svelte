<script>
  // One conversation turn, either tier, live or restored: a user line, or an
  // answer — import card | chat error line | markdown text → document actions →
  // actions → option card → cards (with their sources note) → help link → the router's guesses.
  import * as m from '$lib/paraglide/messages';
  import { renderMarkdown } from '$lib/helpers/markdown.js';
  import TermiAvatar from './TermiAvatar.svelte';
  import TermiAnswer from './TermiAnswer.svelte';
  import ItemCards from './cards/ItemCards.svelte';
  import OptionsCard from './cards/OptionsCard.svelte';
  import ImportPreviewCard from './import/ImportPreviewCard.svelte';
  import { resolve } from '$app/paths';
  import { fromDocumentStart, isDocumentAnswer, withoutHtmlComments } from './document-export.js';
  import { actionsFor, runAnswerAction } from './answer-actions.js';
  import { modelLabel, serviceLabel } from '$lib/termi/model-choice.js';

  // static map: never index the Paraglide namespace by a runtime key
  const BUSY = {
    material: m.termi_busy_material,
    curriculum: m.termi_busy_curriculum,
    people: m.termi_busy_people,
    sheet: m.termi_busy_sheet,
    writing: m.termi_busy_writing
  };
  const FALLBACK = {
    capacity: m.termi_model_fallback_capacity,
    no_start: m.termi_model_fallback_no_start
  };

  /** @typedef {import('./history/conversation-codec.js').Turn} Turn */
  /** @typedef {import('./import/publish-imported.js').ImportState} ImportState */
  // A rendered turn holds Items: toTier1Message turns stored SlimItems back into Items.
  /** @typedef {import('$lib/termi/items.d.js').Item} Item */
  /**
   * @type {{
   *   turn: Turn,
   *   ctx: {
   *     retryOf: (turn: Turn) => (() => void) | undefined,
   *     regenerate: () => void,
   *     onSearchAuthor: (person: any) => void,
   *     send?: (text: string) => void,
   *     canPick?: (turn: Turn) => boolean,
   *     workbench?: boolean,
   *     full?: boolean,
   *     latestId?: string,
   *     modelNames?: Record<string, string>,
   *     partLines?: Record<string, { key: string, title: string, changed: boolean, superseded?: 'same'|'other' }[]>,
   *     onShowPart?: (key: string) => void,
   *     actionCtx: import('./answer-actions.js').AnswerActionCtx,
   *     importActions: {
   *       reextract: (id: string) => void,
   *       publish: (id: string) => void,
   *       retry: (id: string) => void,
   *       update: (id: string, patch: Partial<ImportState>) => void,
   *       stop: (id: string) => void
   *     }
   *   }
   * }} `workbench`: the parts are read in the Werkbank; a turn that wrote some
   *   (`partLines`, by turn id) shows one line per part instead of their text
   */
  let { turn, ctx } = $props();

  // By value: a re-projected turn with the same text does not render its markdown again.
  const text = $derived(turn.text);
  const items = $derived(/** @type {Item[] | undefined} */ (turn.items));
  // Every answer text as markdown: a restored tier-2 answer re-saved as tier 1 stays rendered; canned texts are plain.
  // a part another document took over (its key, another title) is read here, as outside the Werkbank
  const lines = $derived.by(() => {
    const own = ctx.workbench ? ctx.partLines?.[turn.id ?? ''] : undefined;
    return own?.some((l) => l.superseded === 'other') ? undefined : own;
  });
  // in the Werkbank only what the answer says before its first part (an ask document: before its start) stays
  const shown = $derived.by(() => {
    if (!lines) return text;
    if (!lines.some((l) => l.key === 'document')) return text.split(/<!--\s*termi:part\b/)[0];
    const t = text.trim();
    return t.slice(0, t.length - fromDocumentStart(t).length);
  });
  // links stay only where their target came from a tool result of this conversation (no rules: text)
  const links = $derived(ctx.actionCtx?.links);
  const html = $derived(
    renderMarkdown(links ? links.safe(withoutHtmlComments(shown)) : withoutHtmlComments(shown), {
      allowLinks: links?.ok ?? false
    })
  );
  // a live chat answer: wider, its markdown alone sets the line breaks
  const live = $derived(turn.role !== 'user' && turn.tier === 2 && !turn.error);
  // under a document or a lesson part the cards are its sources: folded away behind one toggle
  const sourcesCollapsed = $derived(/<!--\s*termi:part\b/.test(text) || isDocumentAnswer(text));
</script>

<div
  class="flex items-end gap-2.5 {turn.role === 'user' ? 'justify-end' : ''}"
  data-testid="termi-answer"
  data-role={turn.role}
  data-turn-id={turn.id}
>
  {#if turn.role !== 'user'}
    <TermiAvatar />
  {/if}
  <div
    class="min-w-0 rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed {live
      ? 'max-w-[88%]'
      : 'max-w-[82%] whitespace-pre-line'} {turn.role === 'user'
      ? 'rounded-br-md bg-primary break-words text-primary-content'
      : 'rounded-bl-md border border-base-300 bg-base-200'}"
  >
    {#if turn.role === 'user'}
      {turn.text}
    {:else if turn.import && turn.id}
      {@const id = turn.id}
      {@const state = turn.import}
      {#if state.status === 'failed'}
        <div data-testid="termi-import-status">
          {state.quota === 'user'
            ? m.termi_import_quota()
            : state.quota === 'global'
              ? m.termi_import_quota_global()
              : state.quota === 'ineligible'
                ? m.termi_import_not_eligible()
                : m.termi_import_failed()}
        </div>
        {#if !state.quota}
          <button
            type="button"
            data-testid="termi-import-retry"
            class="btn mt-2 btn-sm btn-primary"
            onclick={() => ctx.importActions.reextract(id)}
          >
            {m.termi_import_reextract()}
          </button>
        {/if}
      {:else if state.status === 'extracting'}
        <span class="termi-typing"><i></i><i></i><i></i></span>
      {:else}
        <ImportPreviewCard
          {state}
          onUpdate={(patch) => ctx.importActions.update(id, patch)}
          onPublish={() => ctx.importActions.publish(id)}
          onRetry={() => ctx.importActions.retry(id)}
          onStop={() => ctx.importActions.stop(id)}
          onReextract={() => ctx.importActions.reextract(id)}
        />
      {/if}
    {:else if turn.error}
      {@const error = turn.error}
      {#if error.status === 429}
        <!-- 'user' = today's own cap, 'global' = the monthly cap, 'external' = the outside
             allowance (the choice is back at GWDG); no scope = another tab's request (busy). -->
        {#if error.scope === 'external'}
          {m.termi_model_quota_external()}
        {:else if error.scope === 'user'}
          {m.termi_quota()}
        {:else if error.scope === 'global'}
          {m.termi_quota_global()}
        {:else}
          {m.termi_busy()}
        {/if}
        {#if error.scope && error.scope !== 'external'}
          <div class="mt-2">
            <a href={error.href} class="btn btn-sm btn-primary">{m.termi_quota_link()}</a>
          </div>
        {/if}
      {:else}
        {error.unavailable ? m.termi_model_unavailable() : m.termi_assistant_error()}
        <div class="mt-2 flex flex-wrap gap-2">
          <a href={error.href} class="btn btn-ghost btn-sm">{m.termi_quota_link()}</a>
          <button type="button" class="btn btn-sm btn-primary" onclick={ctx.regenerate}>
            {m.termi_assistant_retry()}
          </button>
        </div>
      {/if}
    {:else}
      {#if lines}
        {#if shown.trim()}
          <div class="termi-md mb-2 whitespace-normal">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- safe: renderMarkdown escapes raw HTML, drops images, keeps only checked links, DOMPurify -->
            {@html html}
          </div>
        {/if}
        {#each lines as line (line.key)}
          <div class="flex items-center gap-2 whitespace-normal" data-testid="termi-part-line">
            <span class="min-w-0 flex-1">
              {line.superseded
                ? m.termi_werkbank_part_superseded({ title: line.title })
                : line.changed
                  ? m.termi_werkbank_part_changed({ title: line.title })
                  : m.termi_werkbank_part_written({ title: line.title })}
            </span>
            <!-- an earlier version: "Ansehen" would open the text that replaced it -->
            {#if !line.superseded}
              <button type="button" class="btn btn-sm" onclick={() => ctx.onShowPart?.(line.key)}>
                {m.termi_werkbank_show()}
              </button>
            {/if}
          </div>
        {/each}
      {:else if text}
        <!-- Markdown; images/raw HTML only as text, links only when checked (see `links`). -->
        <div class="termi-md whitespace-normal">
          <!-- eslint-disable-next-line svelte/no-at-html-tags -- safe: renderMarkdown escapes raw HTML, drops images, keeps only checked links, DOMPurify -->
          {@html html}
        </div>
      {/if}
      {@const answerActions = lines ? [] : actionsFor(turn, ctx.actionCtx)}
      {#if answerActions.length && turn.id}
        {@const id = turn.id}
        <div class="mt-2 flex flex-wrap gap-2" data-testid="termi-doc-actions">
          {#each answerActions as action (action.id)}
            {@const state = ctx.actionCtx.getState(id, action.id)}
            <button
              type="button"
              class="btn btn-sm {action.ghost ? 'btn-ghost' : 'btn-primary'}"
              data-testid="termi-doc-{action.id}"
              disabled={state?.busy}
              onclick={() => runAnswerAction(turn, action, ctx.actionCtx)}
            >
              {#if state?.busy}
                <span class="loading loading-xs loading-spinner"></span>
              {/if}
              {action.label(ctx.actionCtx, state)}
            </button>
          {/each}
        </div>
        {#if turn.artifacts?.draftNaddr}
          <p class="mt-1 text-xs" data-testid="termi-doc-draft-saved">
            {m.termi_doc_draft_saved()}
            <a
              href={resolve('/create/article') + `?edit=${turn.artifacts.draftNaddr}`}
              onclick={ctx.actionCtx.close}
              class="link">{m.termi_doc_draft_edit()}</a
            >
          </p>
        {:else if ctx.actionCtx.getState(id, 'liascript')?.failed}
          <p class="mt-1 text-xs text-error" data-testid="termi-doc-draft-failed">
            {m.termi_doc_draft_failed()}
          </p>
        {/if}
        {#if ctx.actionCtx.getState(id, 'load_draft')?.failed}
          <p class="mt-1 text-xs text-error" data-testid="termi-lesson-draft-unreadable">
            {m.termi_lesson_draft_unreadable()}
          </p>
        {/if}
      {/if}
      {#if turn.actions?.length}
        <TermiAnswer text="" actions={turn.actions} />
      {/if}
      {#if turn.options}
        <OptionsCard card={turn.options} onSend={ctx.canPick?.(turn) ? ctx.send : undefined} />
      {/if}
    {/if}
    {#if turn.role !== 'user' && !turn.error && (turn.pending || ctx.latestId === turn.id)}
      <!-- mounted before it has text (a live region inserted filled is often not announced); the text changes only with the label -->
      <p role="status" aria-live="polite" data-testid="termi-busy">
        {#if turn.pending && !ctx.workbench}
          <span class="mt-1.5 flex items-center gap-2 text-xs text-base-content/60">
            <span class="termi-typing"><i></i><i></i><i></i></span>
            {BUSY[turn.busy ?? 'writing']()}
          </span>
        {/if}
      </p>
    {/if}
    {#if turn.role !== 'user' && turn.model && !turn.pending && !turn.error}
      {@const names = ctx.modelNames ?? {}}
      {@const model = { model: modelLabel(turn.model, names), service: serviceLabel(turn.model) }}
      {@const fallback = turn.fallback
        ? ` ${FALLBACK[turn.fallback.reason]({ chosen: modelLabel(turn.fallback.from, names) })}`
        : ''}
      <p class="mt-1 text-xs opacity-60" data-testid="termi-model">
        {m.termi_model_line(model)}{fallback}
      </p>
    {/if}
    {#if turn.role !== 'user' && !lines && (turn.items || turn.sourcesUnavailable)}
      <ItemCards
        {items}
        sourcesUnavailable={turn.sourcesUnavailable}
        query={turn.query}
        collapsed={sourcesCollapsed}
        fold={ctx.full ? Infinity : undefined}
        onRetry={ctx.retryOf(turn)}
        onSearchAuthor={ctx.onSearchAuthor}
      />
    {/if}
    {#if turn.link}
      <a {...turn.link.attrs} data-testid="termi-help-link" class="btn mt-2 btn-sm btn-primary">
        {turn.link.label}
      </a>
    {/if}
    {#if turn.guesses?.length}
      <div class="mt-2">
        <TermiAnswer text={m.termi_route_maybe()} actions={turn.guesses} />
      </div>
    {/if}
  </div>
</div>

<style>
  /* Answers: compact markdown inside a chat bubble. */
  .termi-md > :global(:first-child) {
    margin-top: 0;
  }
  .termi-md > :global(:last-child) {
    margin-bottom: 0;
  }
  .termi-md :global(:is(h3, h4, h5, h6)) {
    margin: 0.75em 0 0.25em;
    font-size: 1em;
    font-weight: 600;
  }
  .termi-md :global(:is(p, ul, ol, blockquote, pre)) {
    margin: 0.4em 0;
  }
  .termi-md :global(:is(ul, ol)) {
    padding-left: 1.25em;
  }
  .termi-md :global(ul) {
    list-style: disc;
  }
  .termi-md :global(ol) {
    list-style: decimal;
  }
  .termi-md :global(li + li) {
    margin-top: 0.15em;
  }
  .termi-md :global(blockquote) {
    border-left: 2px solid var(--color-base-300);
    padding-left: 0.6em;
    font-style: italic;
  }
  .termi-md :global(code) {
    border-radius: 0.25em;
    background: var(--color-base-300);
    padding: 0 0.25em;
    font-size: 0.9em;
  }
  .termi-md :global(pre) {
    overflow-x: auto;
    white-space: pre;
  }
</style>
