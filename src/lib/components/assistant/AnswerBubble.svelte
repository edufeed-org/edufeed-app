<script>
  // One conversation turn, either tier, live or restored: a user line, or an
  // answer — import card | chat error line | markdown text → document actions →
  // actions → cards (with their sources note) → help link → the router's guesses.
  import * as m from '$lib/paraglide/messages';
  import { renderMarkdown } from '$lib/helpers/markdown.js';
  import TermiAvatar from './TermiAvatar.svelte';
  import TermiAnswer from './TermiAnswer.svelte';
  import ItemCards from './cards/ItemCards.svelte';
  import ImportPreviewCard from './import/ImportPreviewCard.svelte';
  import { isDocumentAnswer, withoutHtmlComments } from './document-export.js';

  /** @typedef {import('./history/conversation-codec.js').Turn} Turn */
  /** @typedef {import('./import/publish-imported.js').ImportState} ImportState */
  /**
   * @type {{
   *   turn: Turn,
   *   ctx: {
   *     retryOf: (turn: Turn) => (() => void) | undefined,
   *     regenerate: () => void,
   *     onSearchAuthor: (person: any) => void,
   *     docActions: import('svelte').Snippet<[Turn]>,
   *     importActions: {
   *       reextract: (id: string) => void,
   *       publish: (id: string, keys?: Set<string>) => void,
   *       update: (id: string, patch: Partial<ImportState>) => void,
   *       stop: (id: string) => void
   *     }
   *   }
   * }}
   */
  let { turn, ctx } = $props();

  // By value: a re-projected turn with the same text does not render its markdown again.
  const text = $derived(turn.text);
  // Every answer text as markdown: a restored tier-2 answer re-saved as tier 1 stays rendered; canned texts are plain.
  const html = $derived(renderMarkdown(withoutHtmlComments(text), { allowLinks: false }));
  // a live chat answer: wider, its markdown alone sets the line breaks
  const live = $derived(turn.role !== 'user' && turn.tier === 2 && !turn.error);
</script>

<div
  class="flex items-end gap-2.5 {turn.role === 'user' ? 'justify-end' : ''}"
  data-testid="termi-answer"
  data-role={turn.role}
>
  {#if turn.role !== 'user'}
    <TermiAvatar />
  {/if}
  <div
    class="rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed {live
      ? 'max-w-[88%]'
      : 'max-w-[82%] whitespace-pre-line'} {turn.role === 'user'
      ? 'rounded-br-md bg-primary break-words whitespace-pre-line text-primary-content'
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
          onRetry={() =>
            ctx.importActions.publish(
              id,
              new Set([
                ...(state.result?.failed.map((f) => f.key) ?? []),
                ...(state.result?.skipped ?? [])
              ])
            )}
          onStop={() => ctx.importActions.stop(id)}
          onReextract={() => ctx.importActions.reextract(id)}
        />
      {/if}
    {:else if turn.error}
      {@const error = turn.error}
      {#if error.status === 429}
        <!-- 'user' = today's own cap, 'global' = the monthly cap; no
             scope = another tab's request (busy), nothing to rescue. -->
        {#if error.scope === 'user'}
          {m.termi_quota()}
        {:else if error.scope === 'global'}
          {m.termi_quota_global()}
        {:else}
          {m.termi_busy()}
        {/if}
        {#if error.scope}
          <div class="mt-2">
            <a href={error.href} class="btn btn-sm btn-primary">{m.termi_quota_link()}</a>
          </div>
        {/if}
      {:else}
        {m.termi_assistant_error()}
        <div class="mt-2 flex flex-wrap gap-2">
          <a href={error.href} class="btn btn-ghost btn-sm">{m.termi_quota_link()}</a>
          <button type="button" class="btn btn-sm btn-primary" onclick={ctx.regenerate}>
            {m.termi_assistant_retry()}
          </button>
        </div>
      {/if}
    {:else}
      {#if text}
        <!-- Markdown; links/images/raw HTML only as text (links come through cards). -->
        <div class="termi-md whitespace-normal">
          <!-- eslint-disable-next-line svelte/no-at-html-tags -- safe: renderMarkdown allowLinks:false escapes raw HTML, drops links/images, DOMPurify -->
          {@html html}
        </div>
      {/if}
      <!-- sourcesLost: the history cap dropped the outputs — no export without its sources -->
      {#if !turn.pending && isDocumentAnswer(text) && !turn.sourcesLost}
        {@render ctx.docActions(turn)}
      {/if}
      {#if turn.actions?.length}
        <TermiAnswer text="" actions={turn.actions} />
      {/if}
    {/if}
    {#if turn.role !== 'user' && (turn.items || turn.sourcesUnavailable)}
      <ItemCards
        items={turn.items}
        sourcesUnavailable={turn.sourcesUnavailable}
        query={turn.query}
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
