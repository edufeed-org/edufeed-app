/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import WerkbankDoc from '../assistant/werkbank/WerkbankDoc.svelte';

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
