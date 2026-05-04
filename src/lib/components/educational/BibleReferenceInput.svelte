<script>
  import { BIBLE_BOOKS_DE, parseAndCanonicalize } from '$lib/helpers/educational/bibleReference.js';

  // Unique datalist id per instance so the browser typeahead always finds
  // its own options even when several inputs are rendered side-by-side.
  const listId = `bible-books-${crypto.randomUUID()}`;

  /**
   * @type {{
   *   value: string,
   *   placeholder?: string,
   *   onremove?: () => void
   * }}
   */
  let { value = $bindable(''), placeholder = 'z. B. Mt 5,3-12', onremove } = $props();

  /** @type {'idle' | 'parsing' | 'ok' | 'unparseable'} */
  let status = $state('idle');
  /** @type {string | null} */
  let canonical = $state(null);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let debounce;

  function scheduleParse() {
    if (debounce) clearTimeout(debounce);
    const trimmed = value.trim();
    if (!trimmed) {
      status = 'idle';
      canonical = null;
      return;
    }
    status = 'parsing';
    debounce = setTimeout(async () => {
      const captured = value.trim();
      const result = await parseAndCanonicalize(captured);
      // Discard stale results if the input changed during the await.
      if (captured !== value.trim()) return;
      if (result.ok) {
        canonical = result.canonical;
        status = 'ok';
      } else {
        canonical = null;
        status = 'unparseable';
      }
    }, 300);
  }

  function applyCanonical() {
    if (canonical) {
      value = canonical;
      status = 'ok';
    }
  }

  // Trigger parse whenever the user edits the field.
  $effect(() => {
    // Touch `value` so the effect re-runs on every change.
    void value;
    scheduleParse();
    return () => {
      if (debounce) clearTimeout(debounce);
    };
  });
</script>

<div class="space-y-1">
  <div class="flex gap-2">
    <input
      type="text"
      class="input-bordered input flex-1"
      class:input-success={status === 'ok' && canonical === value.trim()}
      list={listId}
      {placeholder}
      bind:value
    />
    <datalist id={listId}>
      {#each BIBLE_BOOKS_DE as book (book)}
        <option value={book}></option>
      {/each}
    </datalist>
    {#if onremove}
      <button type="button" class="btn btn-ghost btn-sm" aria-label="Entfernen" onclick={onremove}
        >×</button
      >
    {/if}
  </div>

  {#if status === 'ok' && canonical && canonical !== value.trim()}
    <div class="flex items-center gap-2 text-xs">
      <span class="text-success">Erkannt: <strong>{canonical}</strong></span>
      <button type="button" class="btn btn-ghost btn-xs" onclick={applyCanonical}>Übernehmen</button
      >
    </div>
  {:else if status === 'ok'}
    <div class="text-xs text-success">✓ Erkannt</div>
  {:else if status === 'unparseable'}
    <div class="text-xs text-base-content/50">
      Nicht als Bibelstelle erkannt — wird als Freitext gespeichert.
    </div>
  {/if}
</div>
