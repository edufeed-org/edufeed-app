/**
 * Pure presentation helpers for the editorial AMB resource detail view
 * (AMBResourceView). Kept framework-free so they can be unit-tested in node.
 */

/**
 * Split a title into `{ main, script, tail }` for the hero's script-accent
 * treatment. Only ever splits on word boundaries so words are never broken.
 *
 * - 0–1 words: no accent — everything goes in `main`.
 * - 2 words:  the second word becomes the script accent.
 * - 3+ words: the longest interior word (never the first or last) becomes the
 *   accent, keeping the words before it in `main` and after it in `tail`.
 *
 * @param {string} title
 * @returns {{ main: string, script: string, tail: string }}
 */
export function splitTitle(title) {
  const words = String(title ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2) return { main: words.join(' '), script: '', tail: '' };
  if (words.length === 2) return { main: words[0], script: words[1], tail: '' };

  let idx = 1;
  let len = 0;
  for (let i = 1; i < words.length - 1; i++) {
    if (words[i].length > len) {
      len = words[i].length;
      idx = i;
    }
  }
  return {
    main: words.slice(0, idx).join(' '),
    script: words[idx],
    tail: words.slice(idx + 1).join(' ')
  };
}

/**
 * Decide whether the hero should keep the script accent for a title. Long titles
 * and long accent words break awkwardly in the Caveat block, so we suppress the
 * accent and fold the whole title back into `main` (word order preserved).
 *
 * @param {{ main: string, script: string, tail: string }} parts
 * @param {string} fullTitle
 * @returns {{ main: string, script: string, tail: string }}
 */
export function guardScriptAccent(parts, fullTitle) {
  const tooLong = String(fullTitle ?? '').length > 90 || parts.script.length > 16;
  if (!tooLong) return parts;
  return {
    main: [parts.main, parts.script, parts.tail].filter(Boolean).join(' '),
    script: '',
    tail: ''
  };
}

/**
 * Format an attribution line from a list of author names. Follows the CC-BY
 * principle that names are never silently dropped — past two authors we
 * collapse to "et al." rather than truncating mid-name.
 *
 * - 0 names: ''
 * - 1 name:  "A"
 * - 2 names: "A & B"
 * - 3+ names: "A, B et al."
 *
 * @param {Array<string> | null | undefined} names
 * @returns {string}
 */
export function formatCreatorsLine(names) {
  const list = (names ?? []).filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} & ${list[1]}`;
  return `${list[0]}, ${list[1]} et al.`;
}

/**
 * @typedef {Object} ExtensionFact
 * @property {string} ns
 * @property {string} facetName
 * @property {'concept' | 'scalar' | 'boolean'} kind
 * @property {string} value  All display values joined with ', ' (empty for booleans)
 * @property {string[]} items  All display values (scalar raw values / concept labels; empty for booleans)
 * @property {number} count  Number of items the facet carried
 */

/**
 * Flatten parsed extension namespaces (output of `parseExtensionTags`) into a
 * concise, ordered list of facts suitable for the hero strip and metadata
 * grid.
 *
 * - boolean flags set to "false" are skipped (a disabled flag is not a fact).
 * - boolean flags set to "true" become a value-less fact of kind `boolean`
 *   (the caller renders a checkmark / "yes").
 * - concept facets surface every localized label, joined with ', ' — a resource
 *   tagged with three Schularten must show all three, not just the first.
 * - scalar facets surface every value the same way (long free-text is still
 *   returned so the caller can decide how to render it).
 *
 * @param {{ namespaces: Map<string, { facets: Map<string, { kind: 'concept'|'scalar', items: any[] }> }> } | null | undefined} parsed
 * @param {{ limit?: number, locale?: string }} [opts]
 * @returns {ExtensionFact[]}
 */
export function summarizeExtensionFacets(parsed, opts = {}) {
  const { limit = Infinity, locale = 'en' } = opts;
  /** @type {ExtensionFact[]} */
  const out = [];
  if (!parsed?.namespaces) return out;

  for (const [ns, nsEntry] of parsed.namespaces) {
    for (const [facetName, facet] of nsEntry.facets) {
      if (out.length >= limit) return out;

      if (facet.kind === 'scalar') {
        const items = facet.items.filter(Boolean);
        if (items.length === 0) continue;
        if (items.length === 1 && items[0] === 'false') continue;
        if (items.length === 1 && items[0] === 'true') {
          out.push({ ns, facetName, kind: 'boolean', value: '', items: [], count: 1 });
          continue;
        }
        out.push({
          ns,
          facetName,
          kind: 'scalar',
          value: items.join(', '),
          items,
          count: items.length
        });
      } else {
        const labels = facet.items.map((it) => pickConceptLabel(it, locale)).filter(Boolean);
        if (labels.length === 0) continue;
        out.push({
          ns,
          facetName,
          kind: 'concept',
          value: labels.join(', '),
          items: labels,
          count: facet.items.length
        });
      }
    }
  }
  return out;
}

/**
 * Pick a localized label from a concept item's prefLabels, falling back
 * through locale → de → en → any → id.
 * @param {{ id?: string, prefLabels?: Record<string, string> }} item
 * @param {string} locale
 * @returns {string}
 */
function pickConceptLabel(item, locale) {
  const p = item?.prefLabels ?? {};
  return p[locale] || p.de || p.en || Object.values(p)[0] || item?.id || '';
}
