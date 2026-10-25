/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
// Vite's ?raw import instead of fs: a node builtin import fails to load under
// the jsdom environment in this repo's vitest setup ("No such built-in module: node:").
import appHtml from '../../../app.html?raw';
import {
  leftServerRenderedPage,
  removeServerBody,
  removeServerHeadExtras
} from '$lib/helpers/geo-server-content.js';

describe('geo server content cleanup', () => {
  beforeEach(() => {
    document.head.innerHTML =
      '<link rel="canonical" href="https://a.example/x"><script type="application/ld+json" id="geo-jsonld">{}</script><link rel="manifest" href="/m">';
    document.body.innerHTML =
      '<div style="display: contents"></div><article id="geo-content"><h1>T</h1></article>';
  });

  it('removes the server body block', () => {
    removeServerBody(document);
    expect(document.getElementById('geo-content')).toBeNull();
  });

  it('removes canonical and JSON-LD but nothing else in head', () => {
    removeServerHeadExtras(document);
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.getElementById('geo-jsonld')).toBeNull();
    expect(document.head.querySelector('link[rel="manifest"]')).not.toBeNull();
  });

  it('is a no-op on pages without injected markup', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    expect(() => {
      removeServerBody(document);
      removeServerHeadExtras(document);
    }).not.toThrow();
  });
});

describe('app.html', () => {
  const html = appHtml;

  it('marks JavaScript clients before first paint and hides the crawler block for them', () => {
    expect(html).toContain("document.documentElement.classList.add('js')");
    expect(html).toMatch(/\.js #geo-content\s*\{\s*display: none;/);
  });

  it('hides the loader for clients without JavaScript so the crawler block is readable', () => {
    expect(html).toMatch(/html:not\(\.js\) #app-loader\s*\{\s*display: none;/);
  });
});

describe('leftServerRenderedPage', () => {
  const at = (/** @type {string} */ u) => ({ url: new URL(u, 'https://a.example') });
  it('is false for the initial load and same-path navigations', () => {
    expect(leftServerRenderedPage(null, at('/wiki/x'))).toBe(false);
    expect(leftServerRenderedPage(at('/wiki/x'), at('/wiki/x'))).toBe(false);
    expect(leftServerRenderedPage(at('/wiki/x'), at('/wiki/x#faq'))).toBe(false);
  });
  it('is true once the path changes', () => {
    expect(leftServerRenderedPage(at('/wiki/x'), at('/discover'))).toBe(true);
  });
});
