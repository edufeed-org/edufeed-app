<!--
  MetadataCleanerModal
  Optional pre-upload review step backed by the metadata-cleaner service
  (via /api/metaclean). Shows all metadata the file carries, lets the user
  strip tool provenance and (PDF only) recompress embedded images, then
  resolves with either the cleaned or the original File via ondone().
  ondone fires exactly once per open cycle.
-->

<script>
  import { topLayerModal } from '$lib/actions/topLayerModal.js';
  import * as m from '$lib/paraglide/messages';
  import {
    inspectFile,
    getStripOps,
    applyOps,
    downloadCleaned,
    isPdfFile,
    groupFieldsByStore
  } from '$lib/helpers/metaclean.js';

  /** @type {{ open?: boolean, file: File | null, ondone?: (file: File) => void }} */
  let { open = $bindable(false), file = null, ondone = () => {} } = $props();

  /** @type {'inspecting' | 'review' | 'applying' | 'done' | 'error'} */
  let phase = $state('inspecting');
  let errorMessage = $state('');
  let sessionId = $state('');
  /** @type {import('$lib/helpers/metaclean.js').MetaField[]} */
  let fields = $state.raw([]);
  /** @type {import('$lib/helpers/metaclean.js').Op[]} */
  let stripOps = $state.raw([]);
  let stripEnabled = $state(true);
  /** @type {'off' | 'balanced' | 'strong'} */
  let compress = $state('off');
  /** @type {import('$lib/helpers/metaclean.js').ApplyResult | null} */
  let applyResult = $state.raw(null);

  // Guards double-fire of ondone (e.g. Escape after a button click).
  let doneFired = false;

  const isPdf = $derived(file ? isPdfFile(file) : false);
  const groupedFields = $derived(groupFieldsByStore(fields));
  const stripFieldLabels = $derived(
    stripOps.map((op) => (op.type === 'delete' ? op.fieldId : null)).filter((id) => id !== null)
  );
  const canApply = $derived((stripEnabled && stripOps.length > 0) || (isPdf && compress !== 'off'));

  // Inspect whenever the modal opens for a file. `open` and `file` are read
  // first so the effect re-runs on every open cycle.
  $effect(() => {
    if (!open || !file) return;
    doneFired = false;
    runInspect(file);
  });

  /** @param {File} target */
  async function runInspect(target) {
    phase = 'inspecting';
    errorMessage = '';
    applyResult = null;
    stripEnabled = true;
    compress = 'off';
    try {
      const inspected = await inspectFile(target);
      sessionId = inspected.sessionId;
      fields = inspected.fields ?? [];
      const strip = await getStripOps(inspected.sessionId);
      stripOps = strip.ops ?? [];
      phase = 'review';
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
      phase = 'error';
    }
  }

  async function handleApply() {
    if (!canApply) return;
    phase = 'applying';
    errorMessage = '';
    try {
      applyResult = await applyOps(sessionId, {
        ops: stripEnabled ? stripOps : [],
        compress
      });
      phase = 'done';
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
      phase = 'error';
    }
  }

  /** @param {File} result */
  function finish(result) {
    if (doneFired) return;
    doneFired = true;
    open = false;
    ondone(result);
  }

  function handleKeepOriginal() {
    if (file) finish(file);
  }

  async function handleUseCleaned() {
    if (!file) return;
    try {
      const cleaned = await downloadCleaned(sessionId, file.name, file.type);
      finish(cleaned);
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
      phase = 'error';
    }
  }

  function handleRetry() {
    if (file) runInspect(file);
  }

  /** @param {number} bytes */
  function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
</script>

{#if open}
  <dialog class="modal-open modal" use:topLayerModal={handleKeepOriginal}>
    <div class="modal-box max-w-2xl">
      <h3 class="text-lg font-semibold">{m.metaclean_title()}</h3>

      {#if phase === 'inspecting'}
        <div class="flex items-center gap-3 py-8">
          <span class="loading loading-spinner text-primary"></span>
          <span>{m.metaclean_inspecting()}</span>
        </div>
      {:else if phase === 'error'}
        <div class="mt-4 alert alert-error">
          <div>
            <p class="font-medium">{m.metaclean_error_title()}</p>
            <p class="text-sm">{errorMessage}</p>
          </div>
        </div>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onclick={handleRetry}>
            {m.metaclean_retry()}
          </button>
          <button type="button" class="btn btn-primary" onclick={handleKeepOriginal}>
            {m.metaclean_keep_original()}
          </button>
        </div>
      {:else if phase === 'review' || phase === 'applying'}
        <p class="mt-1 text-sm text-base-content/70">{m.metaclean_subtitle()}</p>

        {#if fields.length === 0}
          <p class="py-6 text-sm text-base-content/70">{m.metaclean_no_fields()}</p>
        {:else}
          <div class="mt-4 max-h-64 space-y-3 overflow-y-auto rounded-lg bg-base-200 p-3">
            {#each groupedFields as group (group.store)}
              <div>
                <div class="text-xs font-semibold tracking-wide text-base-content/60 uppercase">
                  {group.store}
                </div>
                <table class="table table-xs">
                  <tbody>
                    {#each group.fields as field (field.id)}
                      <tr>
                        <td class="w-1/3 font-mono text-xs whitespace-nowrap">
                          {field.label}
                          {#if field.sensitive}
                            <span class="ml-1 badge badge-xs badge-warning">
                              {m.metaclean_sensitive_badge()}
                            </span>
                          {/if}
                        </td>
                        <td class="font-mono text-xs break-all">{field.value}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/each}
          </div>
        {/if}

        <div class="mt-4 space-y-3">
          <label class="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              class="toggle mt-0.5 toggle-primary"
              bind:checked={stripEnabled}
              disabled={stripOps.length === 0 || phase === 'applying'}
              data-testid="metaclean-strip-toggle"
            />
            <span>
              <span class="font-medium">{m.metaclean_strip_toggle()}</span>
              <span class="block text-xs text-base-content/60">
                {stripOps.length === 0
                  ? m.metaclean_strip_nothing()
                  : m.metaclean_strip_description()}
              </span>
            </span>
          </label>

          {#if stripEnabled && stripFieldLabels.length > 0}
            <div class="rounded-lg bg-base-200 p-2 text-xs">
              <div class="mb-1 font-medium">{m.metaclean_strip_list_title()}</div>
              <ul class="list-inside list-disc font-mono">
                {#each stripFieldLabels as fieldId (fieldId)}
                  <li>{fieldId}</li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if isPdf}
            <label class="flex items-center gap-3">
              <span class="text-sm font-medium">{m.metaclean_compress_label()}</span>
              <select
                class="select-bordered select select-sm"
                bind:value={compress}
                disabled={phase === 'applying'}
                data-testid="metaclean-compress"
              >
                <option value="off">{m.metaclean_compress_off()}</option>
                <option value="balanced">{m.metaclean_compress_balanced()}</option>
                <option value="strong">{m.metaclean_compress_strong()}</option>
              </select>
            </label>
          {/if}
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={handleKeepOriginal}
            disabled={phase === 'applying'}
          >
            {m.metaclean_keep_original()}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onclick={handleApply}
            disabled={!canApply || phase === 'applying'}
            data-testid="metaclean-apply"
          >
            {#if phase === 'applying'}
              <span class="loading loading-sm loading-spinner"></span>
              {m.metaclean_applying()}
            {:else}
              {m.metaclean_apply()}
            {/if}
          </button>
        </div>
      {:else if phase === 'done' && applyResult}
        <div class="mt-4 space-y-2">
          <h4 class="font-medium">{m.metaclean_result_title()}</h4>
          <p class="text-sm">
            {m.metaclean_fields_before_after({
              before: String(applyResult.before?.length ?? 0),
              after: String(applyResult.after?.length ?? 0)
            })}
          </p>
          <p class="text-sm">
            {m.metaclean_size_before_after({
              before: formatFileSize(applyResult.sizeBefore),
              after: formatFileSize(applyResult.sizeAfter)
            })}
          </p>
          {#if applyResult.leaks && applyResult.leaks.length > 0}
            <div class="alert py-2 alert-warning">
              <span class="text-sm">{m.metaclean_leaks_found()}</span>
            </div>
          {:else}
            <p class="text-sm text-success">{m.metaclean_leaks_clean()}</p>
          {/if}
        </div>

        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onclick={handleKeepOriginal}>
            {m.metaclean_keep_original()}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onclick={handleUseCleaned}
            data-testid="metaclean-use-cleaned"
          >
            {m.metaclean_use_cleaned()}
          </button>
        </div>
      {/if}
    </div>
    <button class="modal-backdrop" onclick={handleKeepOriginal} aria-label="Close">close</button>
  </dialog>
{/if}
