/**
 * Heading anchor helpers for long-form / wiki rendering.
 *
 * Produces stable, document-scoped slugs from heading text and the HTML for a
 * heading that includes both an `id` and an inline anchor link so readers can
 * deep-link to sections.
 */

/**
 * Slugify a string for use as a heading id.
 * Lowercase, strip diacritics, drop punctuation, collapse whitespace to '-'.
 * @param {string} input
 * @returns {string}
 */
export function slugifyHeading(input) {
  if (!input) return '';
  return String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Create a document-scoped slugger that dedupes repeated headings with -1, -2…
 * @returns {(text: string) => string}
 */
export function createSlugger() {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return (text) => {
    const base = slugifyHeading(text) || 'section';
    const count = seen.get(base);
    if (count === undefined) {
      seen.set(base, 0);
      return base;
    }
    const next = count + 1;
    seen.set(base, next);
    return `${base}-${next}`;
  };
}

/**
 * Build the inner HTML for a heading anchor link.
 * Caller is responsible for wrapping it in <hN id="…">…</hN>.
 * @param {string} id
 * @returns {string}
 */
export function headingAnchorLink(id) {
  return `<a class="heading-anchor" href="#${id}" aria-label="Link to section" tabindex="-1">#</a>`;
}
