<script>
  import { normalizeDoi, doiUrl } from '$lib/helpers/publication/doi.js';
  import { fetchDoiPrefill } from '$lib/helpers/publication/crossref.js';
  import * as m from '$lib/paraglide/messages';

  /** Registry-contract adapter for the `doi` field type.
   *  value = the canonical `https://doi.org/<doi>` URL once the input parses as
   *  a DOI (that is what an `amb:id` output wants, and it stays clickable), or
   *  the raw text while it does not, so a half-typed DOI is never lost.
   *  A valid DOI is looked up on Crossref (debounced) and the metadata handed
   *  to `onprefill`, which the renderer routes to sibling fields; it returns
   *  the labels it filled so the respondent sees what happened.
   *  FieldsRenderer renders label/required/error generically — `error` is
   *  accepted per the contract but unused here. */
  /**
   * @type {{
   *   field?: any,
   *   value?: string,
   *   error?: any,
   *   readonly?: boolean,
   *   onchange: (v: string) => void,
   *   onprefill?: (prefill: import('$lib/helpers/publication/crossref.js').DoiPrefill) => string[]
   * }}
   */
  let {
    field,
    value = '',
    error: _error = null,
    readonly = false,
    onchange,
    onprefill = undefined
  } = $props();

  /** What the respondent typed; seeded once from the stored value on purpose —
   *  after that this input, not the parent, owns the text. */
  // svelte-ignore state_referenced_locally
  let text = $state(typeof value === 'string' ? value : '');
  const invalid = $derived(text.trim() !== '' && !normalizeDoi(text));

  let fetching = $state(false);
  /** Labels of the sibling fields the last lookup filled; null = nothing to show. */
  let filledLabels = $state(/** @type {string[] | null} */ (null));
  let noMetadata = $state(false);

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let lastLookedUp = '';
  const DEBOUNCE_MS = 500;

  /** @param {Event} e */
  function handleInput(e) {
    text = /** @type {HTMLInputElement} */ (e.currentTarget).value;
    const doi = normalizeDoi(text);
    onchange(doi ? doiUrl(doi) : text);
    filledLabels = null;
    noMetadata = false;
    clearTimeout(timer);
    if (!doi || !onprefill) return;
    timer = setTimeout(() => lookup(doi), DEBOUNCE_MS);
  }

  /** @param {string} doi */
  async function lookup(doi) {
    if (doi === lastLookedUp) return;
    lastLookedUp = doi;
    fetching = true;
    const prefill = await fetchDoiPrefill(doi);
    fetching = false;
    if (!prefill || Object.keys(prefill).length === 0) {
      noMetadata = true;
      return;
    }
    const labels = onprefill?.(prefill) ?? [];
    filledLabels = labels.length ? labels : null;
  }
</script>

{#if readonly}
  {#if value}
    <a href={value} target="_blank" rel="noopener noreferrer" class="link break-all link-primary"
      >{value}</a
    >
  {:else}
    <span class="text-base-content/50">—</span>
  {/if}
{:else}
  <input
    id={field?.id}
    type="text"
    class="input-bordered input w-full"
    class:input-error={invalid}
    aria-invalid={invalid ? 'true' : undefined}
    placeholder={field?.options?.placeholder || '10.1000/xyz123'}
    value={text}
    oninput={handleInput}
  />
  {#if invalid}
    <p class="mt-1 text-xs text-error">{m.form_doi_invalid()}</p>
  {:else if fetching}
    <p class="mt-1 text-xs text-base-content/60">{m.form_doi_fetching()}</p>
  {:else if filledLabels}
    <p class="mt-1 text-xs text-success" data-testid="doi-prefill-status">
      {m.form_doi_prefill_applied({ fields: filledLabels.join(', ') })}
    </p>
  {:else if noMetadata}
    <p class="mt-1 text-xs text-base-content/60">{m.form_doi_prefill_none()}</p>
  {/if}
{/if}
