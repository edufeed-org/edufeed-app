/**
 * Reader-mode HTML of a fetched third-party page.
 */
import { sanitizeHtml } from '$lib/helpers/htmlSanitize.js';

/**
 * Give h2/h3 ids (TOC + scroll anchors), then sanitize. The ids are added
 * BEFORE sanitizing so the sanitized string is the last thing that touches the
 * markup — re-parsing and re-serializing DOMPurify output invites mutation XSS.
 *
 * @param {string} rawHtml
 * @returns {string}
 */
export function renderReaderHtml(rawHtml) {
  return sanitizeHtml(injectHeadingIds(rawHtml));
}

/** @param {string} html */
function injectHeadingIds(html) {
  if (typeof DOMParser === 'undefined') return html;
  // DOMParser documents are inert: nothing in `html` runs here.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // The page's own ids never pass (they could clobber globals); only ours do.
  doc.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  const used = new Set();
  doc.querySelectorAll('h2, h3').forEach((el) => {
    const base =
      (el.textContent || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'section';
    let id = base;
    let n = 1;
    while (used.has(id)) id = `${base}-${++n}`;
    used.add(id);
    el.id = id;
  });
  return doc.body.innerHTML;
}
