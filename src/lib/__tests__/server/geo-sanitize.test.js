/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { sanitizeServerHtml } from '$lib/server/geo/sanitize.js';

describe('sanitizeServerHtml', () => {
  it('keeps allowed structure and text', () => {
    const html =
      '<h2 class="x">Titel</h2><p>Ein <strong>fetter</strong> und <em>kursiver</em> Satz.</p><ul><li>a</li></ul>';
    expect(sanitizeServerHtml(html)).toBe(
      '<h2>Titel</h2><p>Ein <strong>fetter</strong> und <em>kursiver</em> Satz.</p><ul><li>a</li></ul>'
    );
  });

  it('drops script/style/iframe including their content', () => {
    const out = sanitizeServerHtml(
      '<p>ok</p><script>alert(1)</script><style>p{}</style><iframe src="https://x"></iframe><noscript>n</noscript>'
    );
    expect(out).toBe('<p>ok</p>');
  });

  it('unwraps unknown elements but keeps their text', () => {
    expect(sanitizeServerHtml('<p><font color="red">rot</font></p>')).toBe('<p>rot</p>');
  });

  it('removes event handlers and unknown attributes', () => {
    const out = sanitizeServerHtml(
      '<p onclick="x()" style="color:red" class="c">t</p><img src="https://a.example/i.png" onerror="x()" alt="A">'
    );
    expect(out).toBe('<p>t</p><img src="https://a.example/i.png" alt="A">');
  });

  it('only allows http(s), mailto and relative link targets', () => {
    const out = sanitizeServerHtml(
      '<a href="javascript:alert(1)">a</a><a href=" JaVaScRiPt:alert(1)">b</a><a href="data:text/html,x">c</a>' +
        '<a href="https://ok.example/">d</a><a href="/naddr1x">e</a><a href="mailto:x@y.z">f</a><a href="#anker">g</a>'
    );
    expect(out).toBe(
      '<a rel="nofollow ugc">a</a><a rel="nofollow ugc">b</a><a rel="nofollow ugc">c</a>' +
        '<a href="https://ok.example/" rel="nofollow ugc">d</a><a href="/naddr1x">e</a>' +
        '<a href="mailto:x@y.z" rel="nofollow ugc">f</a><a href="#anker">g</a>'
    );
  });

  it('drops images without an http(s) source', () => {
    expect(sanitizeServerHtml('<img src="javascript:x"><img src="data:image/png;base64,AA">')).toBe(
      ''
    );
  });

  it('escapes text and attribute values', () => {
    const out = sanitizeServerHtml(
      '<p>&lt;script&gt; &amp; "q"</p><img src="https://a.example/?a=1&amp;b=&quot;2" alt="&quot;><script>">'
    );
    expect(out).toBe(
      '<p>&lt;script&gt; &amp; "q"</p><img src="https://a.example/?a=1&amp;b=&quot;2" alt="&quot;&gt;&lt;script&gt;">'
    );
  });

  it('survives a mutation-XSS style payload', () => {
    const out = sanitizeServerHtml(
      '<svg><p><style><img src=x onerror=alert(1)></style></p></svg><math><mi><b>x</b></mi></math>'
    );
    expect(out).not.toMatch(/onerror|<svg|<math|<style|<script/i);
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeServerHtml('')).toBe('');
    expect(sanitizeServerHtml(/** @type {any} */ (null))).toBe('');
  });

  it("drops the app's heading anchor links but keeps heading ids for fragment links", () => {
    const out = sanitizeServerHtml(
      '<h2 id="erste-schritte"><a class="heading-anchor" href="#erste-schritte" aria-label="Link">#</a>Erste Schritte</h2>'
    );
    expect(out).toBe('<h2 id="erste-schritte">Erste Schritte</h2>');
  });

  it("rejects heading ids that could clobber the page's own elements or carry markup", () => {
    expect(sanitizeServerHtml('<h2 id="geo-content">a</h2>')).toBe('<h2>a</h2>');
    expect(sanitizeServerHtml('<h2 id="app-loader">a</h2>')).toBe('<h2>a</h2>');
    expect(sanitizeServerHtml('<h2 id="a b">a</h2>')).toBe('<h2>a</h2>');
    expect(sanitizeServerHtml('<h2 id="__sveltekit_x">a</h2>')).toBe('<h2>a</h2>');
    expect(sanitizeServerHtml('<h2 id="häufige-fragen-faq">a</h2>')).toBe(
      '<h2 id="häufige-fragen-faq">a</h2>'
    );
  });
});
