/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import WerkbankDoc from '../assistant/werkbank/WerkbankDoc.svelte';
import { linkKit } from '$lib/termi/links.js';

const turn = /** @type {const} */ ({ id: 't1', role: 'assistant', tier: 2, text: '' });
const ctx = /** @type {any} */ ({ locale: 'de', getState: () => undefined, setState() {} });
/** @param {any} part */
const doc = (part) =>
  render(WerkbankDoc, {
    props: {
      part: { key: 'lesson-1', kind: 'lesson', title: 'S', turnId: 't1', ...part },
      turn,
      ctx
    }
  });

describe('WerkbankDoc', () => {
  it('marks exactly the changed block', () => {
    const view = doc({ text: 'a\n\nB', prev: 'a\n\nb' });
    const changed = view.container.querySelectorAll('[data-changed]');
    expect(changed).toHaveLength(1);
    expect(changed[0].textContent).toContain('B');
  });

  it('without prev nothing is marked', () => {
    const view = doc({ text: 'a\n\nb' });
    expect(view.container.querySelectorAll('[data-changed]')).toHaveLength(0);
  });

  it('a table renders as one table; a changed row is marked', () => {
    const table = (/** @type {number} */ min) =>
      `| Phase | Min |\n|---|---|\n| Einstieg | ${min} |\n| Sicherung | 10 |`;
    const view = doc({ text: table(5), prev: table(10) });
    expect(view.container.querySelectorAll('table')).toHaveLength(1);
    const changed = view.container.querySelectorAll('[data-changed]');
    expect(changed).toHaveLength(1);
    expect(changed[0].tagName).toBe('TR');
    expect(changed[0].textContent).toContain('Einstieg');
  });

  it('the Kurs view stays while the part is re-projected (a new object, same key and text)', async () => {
    const part = { key: 'module', kind: 'module', title: 'M', turnId: 't1', text: '# M\n\nText' };
    const view = render(WerkbankDoc, { props: { part, turn, ctx } });
    await fireEvent.click(view.getByTestId('werkbank-doc-course'));
    expect(view.getByTestId('werkbank-doc-course').getAttribute('aria-pressed')).toBe('true');
    // a token of another answer streams: the window hands over a fresh part object
    await view.rerender({ part: { ...part }, turn: { ...turn }, ctx });
    expect(view.getByTestId('werkbank-doc-course').getAttribute('aria-pressed')).toBe('true');
    // another part resets the view
    await view.rerender({ part: { ...part, key: 'module-2' }, turn, ctx });
    expect(view.getByTestId('werkbank-doc-text').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('WerkbankDoc links and sources', () => {
  const NADDR = '/naddr1qqxnzd3cxqmrzv3exgmr2wfeqy2hwumn8ghx7un8qg';
  const items = [
    {
      type: 'resource',
      id: 'a',
      title: 'Quelle A',
      href: NADDR,
      sourceUrl: 'https://src.org/a',
      license: 'CC BY 4.0'
    }
  ];
  const withItems = { ...turn, items };
  const linkCtx = () => ({ ...ctx, links: linkKit([withItems], 'http://localhost:3000') });
  const text = `# T\n\nSiehe [Quelle A](${NADDR}) und [X](https://evil.example).`;

  it('renders a checked link, the rest as text; links render as anchors', async () => {
    const view = render(WerkbankDoc, {
      props: {
        part: { key: 'lesson-1', kind: 'lesson', title: 'S', turnId: 't1', text },
        turn: withItems,
        ctx: linkCtx()
      }
    });
    const a = [...view.container.querySelectorAll('article a')];
    expect(a.map((x) => x.getAttribute('href'))).toEqual([NADDR]);
    expect(view.container.textContent).toContain('und X.');
  });

  it('the ask document ends with the sources section, links included; a lesson part gets none', () => {
    const doc = render(WerkbankDoc, {
      props: {
        part: {
          key: 'document',
          kind: 'document',
          title: 'T',
          turnId: 't1',
          text: '# T\n\nQuelle A sagt es.'
        },
        turn: withItems,
        ctx: linkCtx()
      }
    });
    const article = /** @type {HTMLElement} */ (doc.container.querySelector('article'));
    expect(article.textContent).toContain('Quellen und Lizenzen');
    expect(article.querySelector('a')?.getAttribute('href')).toBe('https://src.org/a');
    expect(article.lastElementChild?.textContent).toContain('CC BY 4.0');
    const lesson = render(WerkbankDoc, {
      props: {
        part: {
          key: 'sources',
          kind: 'sources',
          title: 'Q',
          turnId: 't1',
          text: '## Quellen\n\nQuelle A'
        },
        turn: withItems,
        ctx: linkCtx()
      }
    });
    expect(lesson.container.textContent).not.toContain('Quellen und Lizenzen');
  });

  it('the stored text carries no sources section', () => {
    const part = {
      key: 'document',
      kind: 'document',
      title: 'T',
      turnId: 't1',
      text: '# T\n\nQuelle A.'
    };
    render(WerkbankDoc, { props: { part, turn: withItems, ctx: linkCtx() } });
    expect(part.text).not.toContain('Quellen');
  });
});
