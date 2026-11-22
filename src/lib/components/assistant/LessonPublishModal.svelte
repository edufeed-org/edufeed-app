<!--
  Phase 7 of Termi's lesson series: the parts in reading order (✓ published,
  ○ saved as a draft, "fehlt" never saved), licence, "findable as a learning
  resource", then publishLessonSeries — parts, the series (30040) and the
  describing 30142. Every publish is recorded at once, so a failure offers
  "Fehlende veröffentlichen" and a success the share sheet of the series.
  Parts only written in the chat (`turnParts`) are listed as "fehlt" too, and
  "Fehlende Teile speichern" saves them as drafts first (`saveParts`).
-->
<script>
  import { resolve } from '$app/paths';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { partKey, partsInOrder } from '$lib/termi/lesson-state.js';
  import {
    LICENCES,
    defaultLicence,
    publishLessonSeries,
    seriesTitle
  } from '$lib/stores/lesson-publish.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   lessonState: import('$lib/termi/lesson-state.js').LessonState,
   *   draftWraps?: Record<string, string>,
   *   sourcesText?: string,
   *   author?: string,
   *   conversationId?: string,
   *   record: (rec: import('$lib/termi/lesson-state.js').PublishedRecord) => void,
   *   turnParts?: { turnId: string, part: import('$lib/termi/lesson-state.js').LessonPartText }[],
   *   saveParts?: (turnId: string, parts: import('$lib/termi/lesson-state.js').LessonPartText[], onStart: (key: string) => void) => Promise<void>,
   *   onClose: () => void
   * }} `turnParts`: the parts the conversation's answers carry (one per key);
   *   `saveParts`: saves one turn's parts as drafts — the per-turn "Als Entwurf speichern" path
   */
  let {
    lessonState,
    draftWraps = {},
    sourcesText = '',
    author = '',
    conversationId,
    record,
    turnParts = [],
    saveParts,
    onClose
  } = $props();

  const parts = $derived(
    partsInOrder(
      lessonState,
      draftWraps,
      turnParts.map((t) => t.part)
    )
  );
  const missing = $derived(parts.filter((p) => !p.wrap && !p.naddr));
  // the missing parts whose text is in the chat: those can be saved from here, in reading order
  const saveable = $derived(
    saveParts ? missing.flatMap((p) => turnParts.filter((t) => partKey(t.part) === p.key)) : []
  );
  // a never-saved part is left out of the series
  const saved = $derived(parts.filter((p) => p.wrap || p.naddr));
  // her choice from the first render on; the state only proposes
  // svelte-ignore state_referenced_locally
  let licence = $state(defaultLicence(lessonState, sourcesText));
  let asResource = $state(true);
  let busy = $state(false);
  let failed = $state(false);
  let copied = $state(false);
  let progress = $state.raw(/** @type {Record<string, string>} */ ({}));

  const publication = $derived(lessonState?.publication ?? '');
  const complete = $derived(
    saved.length > 0 &&
      saved.every((p) => p.naddr) &&
      !!publication &&
      (!asResource || !!lessonState?.resource)
  );
  const started = $derived(parts.some((p) => p.naddr) || !!publication);

  async function publish() {
    if (busy) return;
    busy = true;
    failed = false;
    try {
      await publishLessonSeries(lessonState, {
        draftWraps,
        asResource,
        licence,
        author,
        conversationId,
        record,
        onProgress: ({ key, status }) => (progress = { ...progress, [key]: status })
      });
    } catch (err) {
      console.error('Termi: publishing the series failed', err);
      failed = true;
    } finally {
      busy = false;
    }
  }

  // "Fehlende Teile speichern": one part after the other (a bunker signs sequentially);
  // consecutive parts of one turn go in one call, so its draftWraps merge once; a failure stops
  async function saveMissing() {
    if (busy || !saveParts) return;
    busy = true;
    const todo = saveable;
    /** @type {string | undefined} */
    let current;
    const settle = (/** @type {string} */ status) => {
      if (current) progress = { ...progress, [current]: status };
      current = undefined;
    };
    try {
      for (let i = 0; i < todo.length; ) {
        const turnId = todo[i].turnId;
        const group = [];
        while (i < todo.length && todo[i].turnId === turnId) group.push(todo[i++].part);
        await saveParts(turnId, group, (key) => {
          settle('');
          current = key;
          progress = { ...progress, [key]: 'busy' };
        });
        settle('');
      }
    } catch (err) {
      console.error('Termi: saving the missing parts failed', err);
      settle('failed');
    } finally {
      busy = false;
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/${publication}`);
      copied = true;
    } catch {
      copied = false;
    }
  }

  function share() {
    modalStore.openModal('shareByNaddr', { naddr: publication, allowedKinds: [30040] });
    onClose();
  }
</script>

<div class="modal-open modal" data-testid="lesson-publish-modal">
  <div class="modal-box max-w-md">
    <h3 class="text-lg font-bold">{m.termi_lesson_publish_title()}</h3>
    <p class="mt-1 text-sm text-base-content/70">{seriesTitle(lessonState)}</p>

    <ol class="mt-4 space-y-1 text-sm" data-testid="lesson-publish-parts">
      {#each parts as part (part.key)}
        {@const status = progress[part.key]}
        <li class="flex items-center gap-2" data-testid="lesson-publish-part" data-key={part.key}>
          <span class="w-5 text-center" aria-hidden="true">
            {#if status === 'busy'}
              <span class="loading loading-xs loading-spinner"></span>
            {:else if part.naddr}
              ✓
            {:else if status === 'failed'}
              ✕
            {:else}
              ○
            {/if}
          </span>
          <span class="flex-1">{part.title}</span>
          {#if !part.wrap && !part.naddr}
            <span class="badge badge-sm badge-warning">{m.termi_lesson_part_missing()}</span>
          {/if}
        </li>
      {/each}
      <li class="flex items-center gap-2 font-medium">
        <span class="w-5 text-center" aria-hidden="true">
          {#if progress.publication === 'busy'}
            <span class="loading loading-xs loading-spinner"></span>
          {:else if publication}
            ✓
          {:else}
            ○
          {/if}
        </span>
        <span class="flex-1">{m.termi_lesson_publish_series()}</span>
      </li>
    </ol>

    {#if missing.length}
      <p class="mt-3 text-sm text-warning" data-testid="lesson-publish-missing-hint">
        {m.termi_lesson_publish_missing_hint()}
      </p>
    {/if}

    {#if complete}
      <div class="mt-4 alert text-sm alert-success" data-testid="lesson-publish-done">
        {m.termi_lesson_published()}
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <a class="btn btn-sm" href={resolve('/[naddr=naddr]', { naddr: publication })}
          >{seriesTitle(lessonState)}</a
        >
        <button type="button" class="btn btn-sm" onclick={copyLink}
          >{copied ? m.termi_doc_copied() : m.termi_lesson_publish_copy()}</button
        >
        <button
          type="button"
          class="btn btn-sm btn-primary"
          data-testid="lesson-publish-share"
          onclick={share}>{m.termi_lesson_publish_share()}</button
        >
      </div>
    {:else}
      <div class="mt-4 flex flex-col gap-3">
        <label class="flex items-center gap-2 text-sm">
          <span>{m.termi_lesson_publish_licence()}</span>
          <select
            class="select-bordered select select-sm"
            bind:value={licence}
            disabled={busy || started}
            data-testid="lesson-publish-licence"
          >
            {#each Object.keys(LICENCES) as option (option)}
              <option value={option}>{option}</option>
            {/each}
          </select>
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            class="checkbox checkbox-sm"
            bind:checked={asResource}
            disabled={busy}
            data-testid="lesson-publish-resource"
          />
          <span>{m.termi_lesson_publish_resource()}</span>
        </label>
      </div>
      {#if failed}
        <p class="mt-3 text-sm text-error" data-testid="lesson-publish-failed">
          {m.termi_lesson_publish_failed()}
        </p>
      {/if}
    {/if}

    <div class="modal-action">
      <button type="button" class="btn btn-ghost" onclick={onClose} disabled={busy}
        >{m.common_close()}</button
      >
      {#if !complete && saveable.length}
        <!-- nothing saved yet: saving IS the next step, so it takes the primary slot -->
        <button
          type="button"
          class="btn {saved.length ? '' : 'btn-primary'}"
          data-testid="lesson-publish-save-missing"
          disabled={busy}
          onclick={saveMissing}
        >
          {#if busy}<span class="loading loading-sm loading-spinner"></span>{/if}
          {saved.length ? m.termi_lesson_save_missing() : m.termi_lesson_save_first()}
        </button>
      {/if}
      {#if !complete && (saved.length || !saveable.length)}
        <button
          type="button"
          class="btn btn-primary"
          data-testid="lesson-publish-submit"
          disabled={busy || saved.length === 0}
          onclick={publish}
        >
          {#if busy}<span class="loading loading-sm loading-spinner"></span>{/if}
          {started || failed ? m.termi_lesson_publish_missing() : m.termi_lesson_publish()}
        </button>
      {/if}
    </div>
  </div>
</div>
