<script>
  import {
    findBookMatches,
    findExactBook,
    parseAndCanonicalize
  } from '$lib/helpers/educational/bibleReference.js';

  /**
   * @type {{
   *   value: string,
   *   placeholder?: string,
   *   onremove?: () => void
   * }}
   */
  let { value = $bindable(''), placeholder = 'z. B. Mt 5,3-12', onremove } = $props();

  let focused = $state(false);
  let activeIndex = $state(-1);

  /** @type {'idle' | 'parsing' | 'ok' | 'partial-book' | 'unparseable'} */
  let status = $state('idle');
  /** @type {string | null} */
  let canonical = $state(null);
  /** @type {{ short: string, long: string } | null} */
  let partialBook = $state(null);

  // Pure derivations — read state, never write. Cannot loop.
  const trimmedValue = $derived(value.trim());
  const exactBook = $derived(findExactBook(trimmedValue));
  const hasDigit = $derived(/\d/.test(trimmedValue));
  const suggestions = $derived(
    focused && trimmedValue && !exactBook ? findBookMatches(trimmedValue) : []
  );

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let debounce;
  /** @type {HTMLInputElement | undefined} */
  let inputEl;

  // Reset highlight when suggestion list changes. Reads `suggestions`,
  // writes `activeIndex` — disjoint read/write set, no loop possible.
  $effect(() => {
    void suggestions;
    activeIndex = -1;
  });

  // Status / canonical / partial-book — driven by the trimmed value.
  // Reads only derived/pure values; writes only status fields.
  $effect(() => {
    if (debounce) clearTimeout(debounce);

    if (!trimmedValue) {
      status = 'idle';
      canonical = null;
      partialBook = null;
      return;
    }

    if (exactBook && !hasDigit) {
      status = 'partial-book';
      partialBook = exactBook;
      canonical = null;
      return;
    }

    if (!hasDigit) {
      // Still typing the book name — stay quiet, dropdown is doing the work.
      status = 'idle';
      canonical = null;
      partialBook = null;
      return;
    }

    status = 'parsing';
    const captured = trimmedValue;
    debounce = setTimeout(async () => {
      const result = await parseAndCanonicalize(captured);
      if (captured !== value.trim()) return;
      if (result.ok) {
        canonical = result.canonical;
        status = 'ok';
        partialBook = null;
      } else {
        canonical = null;
        partialBook = null;
        status = 'unparseable';
      }
    }, 300);

    return () => {
      if (debounce) clearTimeout(debounce);
    };
  });

  function applyCanonical() {
    if (canonical) {
      value = canonical;
      status = 'ok';
    }
  }

  /** @param {{ short: string, long: string }} book */
  function pickSuggestion(book) {
    value = `${book.short} `;
    activeIndex = -1;
    inputEl?.focus();
  }

  /** @param {KeyboardEvent} e */
  function handleKey(e) {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % suggestions.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1;
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      pickSuggestion(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      inputEl?.blur();
    }
  }
</script>

<div class="space-y-1">
  <div class="flex gap-2">
    <div class="relative flex-1">
      <input
        bind:this={inputEl}
        type="text"
        class="input-bordered input w-full"
        class:input-success={status === 'ok' && canonical === value.trim()}
        {placeholder}
        autocomplete="off"
        bind:value
        onfocus={() => (focused = true)}
        onblur={() => (focused = false)}
        onkeydown={handleKey}
      />
      {#if suggestions.length > 0}
        <ul
          class="menu absolute top-full right-0 left-0 z-20 mt-1 max-h-72 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
          role="listbox"
        >
          {#each suggestions as book, i (book.short)}
            <li>
              <button
                type="button"
                class="flex w-full items-center justify-between"
                class:active={i === activeIndex}
                onmousedown={(e) => {
                  // Prevent the input losing focus before our click runs.
                  e.preventDefault();
                  pickSuggestion(book);
                }}
              >
                <span>{book.long}</span>
                <span class="font-mono text-xs text-base-content/50">{book.short}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
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
  {:else if status === 'partial-book' && partialBook}
    <div class="text-xs text-base-content/60">
      <strong>{partialBook.long}</strong> ({partialBook.short}) — Kapitel und Vers ergänzen.
    </div>
  {:else if status === 'unparseable'}
    <div class="text-xs text-base-content/50">
      Nicht als Bibelstelle erkannt — wird als Freitext gespeichert.
    </div>
  {/if}
</div>
