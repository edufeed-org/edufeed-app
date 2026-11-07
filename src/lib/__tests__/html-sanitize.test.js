/**
 * sanitizeHtml is the boundary for untrusted markdown/wiki HTML.
 *
 * - `class` would let content reuse app CSS (`fixed inset-0 z-50`,
 *   `modal modal-open`) to overlay fake UI: only the classes the app's own
 *   renderers emit survive.
 * - `target` always comes with rel="noopener noreferrer".
 * - The hooks live on a dedicated DOMPurify instance and never reach the
 *   global one other components use.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import DOMPurify from 'dompurify';
import { sanitizeHtml } from '$lib/helpers/htmlSanitize.js';

describe('sanitizeHtml', () => {
  it('drops app utility classes an author could use to overlay fake UI', () => {
    const html = sanitizeHtml('<div class="fixed inset-0 z-50 modal modal-open">x</div>');
    expect(html).toBe('<div>x</div>');
  });

  it("keeps the classes the app's renderers emit and strips the rest of the list", () => {
    const html = sanitizeHtml(
      '<h2 id="intro"><a class="heading-anchor fixed" href="#intro">#</a>Intro</h2><a class="anchor" href="#x"></a>'
    );
    expect(html).toContain('<a class="heading-anchor" href="#intro">');
    expect(html).toContain('<a class="anchor" href="#x">');
    expect(html).toContain('id="intro"');
  });

  it('forces rel="noopener noreferrer" on links with a target', () => {
    const div = document.createElement('div');
    div.innerHTML = sanitizeHtml('<a href="https://x.example" target="_blank" rel="opener">x</a>');
    const a = /** @type {HTMLAnchorElement} */ (div.querySelector('a'));
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('leaves the global DOMPurify instance without these hooks', () => {
    sanitizeHtml('<p class="fixed">x</p>');
    expect(DOMPurify.sanitize('<p class="fixed">x</p>')).toBe('<p class="fixed">x</p>');
  });
});
