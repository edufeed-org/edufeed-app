<!--
  MetadataFetchStep: wizard step 2 of the AMB resource form.

  Thin wrapper around `resolveMetadataInput` that owns the input and
  per-state UI. Inspection is fully automatic: debounced on typing and
  immediate on paste. All branching decisions (URL vs naddr, owned vs
  not-owned, etc.) live in the helper.

  The parent receives a single `onresult` callback with the resolve result;
  it decides how to react (prefill form, redirect to edit mode, show error).
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { resolveMetadataInput } from '$lib/helpers/educational/resolveMetadataInput.js';

  /**
   * @type {{
   *   value?: string,
   *   activeUserPubkey?: string | null,
   *   readOnly?: boolean,
   *   mode?: 'smart' | 'manual',
   *   onmodechange?: (mode: 'smart' | 'manual') => void,
   *   onresult?: (result: import('$lib/helpers/educational/resolveMetadataInput.js').ResolveResult) => void
   * }}
   */
  let {
    value = $bindable(''),
    activeUserPubkey = null,
    readOnly = false,
    mode = 'smart',
    onmodechange = () => {},
    onresult = () => {}
  } = $props();

  let isInspecting = $state(false);
  let lastError = $state('');

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let debounceTimer;
  let lastInspectedValue = '';

  // Debounced auto-inspect: 500 ms after the user stops typing.
  $effect(() => {
    // Track the current value so this effect re-runs on every keystroke.
    const current = value;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!current?.trim() || readOnly) return;
    if (isInspecting) return;
    if (current === lastInspectedValue) return;
    debounceTimer = setTimeout(() => {
      inspect();
    }, 500);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  function handlePaste() {
    // Users paste whole URLs/naddrs — skip the debounce entirely.
    // Wait one tick so `value` reflects the pasted text.
    setTimeout(() => {
      if (!value?.trim() || readOnly || isInspecting) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      inspect();
    }, 0);
  }

  async function inspect() {
    if (!value?.trim() || readOnly) return;
    isInspecting = true;
    lastError = '';
    lastInspectedValue = value;
    try {
      const result = await resolveMetadataInput(value, {
        activeUserPubkey,
        fetchFn: fetch
      });
      switch (result.kind) {
        case 'empty':
          lastError = 'Please enter a URL or naddr.';
          break;
        case 'invalid':
          lastError = result.reason;
          break;
        case 'naddr-wrong-kind':
          lastError = 'That naddr does not point to an educational resource.';
          break;
        case 'naddr-not-owned':
          lastError = 'You cannot edit a resource owned by another user.';
          break;
        // 'naddr-edit' and 'url' intentionally produce no user-visible status —
        // the effect (navigation or form prefill) is itself the feedback.
      }
      onresult(result);
    } finally {
      isInspecting = false;
    }
  }
</script>

<div class="space-y-2">
  <label class="label" for="metadata-input">
    <span class="label-text">{m.amb_form_step_url_label?.() ?? 'Resource URL or naddr'}</span>
  </label>
  <input
    id="metadata-input"
    type="text"
    class="input-bordered input w-full"
    placeholder="https://example.org/lesson  —  or  —  naddr1…"
    bind:value
    onpaste={handlePaste}
    readonly={readOnly}
  />

  {#if isInspecting}
    <p class="flex items-center gap-2 text-sm text-base-content/60">
      <span class="loading loading-xs loading-spinner"></span>
      Checking…
    </p>
  {:else if lastError}
    <p class="text-sm text-error">{lastError}</p>
  {/if}

  {#if !readOnly}
    <div class="pt-2">
      <div class="join" role="group" aria-label="Modus für die Metadaten-Übernahme">
        <button
          type="button"
          class="btn join-item {mode === 'smart' ? 'btn-primary' : 'btn-outline'}"
          aria-pressed={mode === 'smart'}
          onclick={() => onmodechange('smart')}
        >
          ✨ Mit KI ausfüllen
        </button>
        <button
          type="button"
          class="btn join-item {mode === 'manual' ? 'btn-primary' : 'btn-outline'}"
          aria-pressed={mode === 'manual'}
          onclick={() => onmodechange('manual')}
        >
          ✍ Manuell ausfüllen
        </button>
      </div>
      <p class="mt-1 text-xs text-base-content/60">
        {#if mode === 'smart'}
          Die KI durchsucht die Seite und schlägt Werte für Fach, Klassenstufe, Lizenz usw. vor.
        {:else}
          Die KI wird nicht aufgerufen — du füllst alle Felder selbst aus.
        {/if}
      </p>
    </div>
  {/if}
</div>
