/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import LiaFrame from '../assistant/werkbank/LiaFrame.svelte';
import WerkbankDoc from '../assistant/werkbank/WerkbankDoc.svelte';
import { playerMarkdown } from '../assistant/document-export.js';

const ORIGIN = 'https://liascript.github.io';
const MD = '# T\n\nHallo';

/** Mounts the frame and waits for its content-hash id. */
async function mount() {
  const view = render(LiaFrame, { props: { markdown: MD } });
  const frame = /** @type {HTMLIFrameElement} */ (await view.findByTitle(/./));
  const win = /** @type {Window} */ (frame.contentWindow);
  const post = vi.spyOn(win, 'postMessage').mockImplementation(() => {});
  const uri = new URL(frame.src).search.slice(1);
  return { view, frame, win, post, uri };
}
/** @param {any} data @param {string} origin @param {any} source */
const ask = (data, origin, source) =>
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));

afterEach(() => vi.restoreAllMocks());

describe('LiaFrame', () => {
  it('points at the player with a parent: address, sandboxed, no referrer', async () => {
    const { frame, uri } = await mount();
    expect(frame.src.startsWith(`${ORIGIN}/course/?parent:`)).toBe(true);
    expect(uri).toMatch(/^parent:[0-9a-f]+$/);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('answers the player’s request once, to the player origin only', async () => {
    const { win, post, uri } = await mount();
    ask({ cmd: 'lia-course', param: { uri } }, ORIGIN, win);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      { cmd: 'lia-course', param: { uri, ok: true, body: playerMarkdown(MD) } },
      ORIGIN
    );
  });

  it('ignores a foreign origin', async () => {
    const { win, post, uri } = await mount();
    ask({ cmd: 'lia-course', param: { uri } }, 'https://evil.example', win);
    expect(post).not.toHaveBeenCalled();
  });

  it('ignores another source, another command and another uri', async () => {
    const { win, post, uri } = await mount();
    ask({ cmd: 'lia-course', param: { uri } }, ORIGIN, window);
    ask({ cmd: 'lia-ready', param: {} }, ORIGIN, win);
    ask({ cmd: 'lia-course', param: { uri: 'parent:other' } }, ORIGIN, win);
    expect(post).not.toHaveBeenCalled();
  });

  it('stops listening when destroyed', async () => {
    const { view, win, post, uri } = await mount();
    view.unmount();
    ask({ cmd: 'lia-course', param: { uri } }, ORIGIN, win);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('playerMarkdown', () => {
  it('puts the header first, keeps one heading, empties blank-ish lines', () => {
    const raw =
      '<!-- termi:part module -->\n# Titel\n\n<!--\nauthor: \nlanguage: de\n-->\n\n# Titel\n\nText\n   \n- [( )] a\n- [(X)] b\n';
    expect(playerMarkdown(raw)).toBe(
      '<!--\nauthor: \nlanguage: de\n-->\n\n# Titel\n\nText\n\n- [( )] a\n- [(X)] b'
    );
  });
  it('keeps both headings when they differ', () => {
    expect(playerMarkdown('# Kurs\n<!--\nauthor: x\n-->\n# Einführung\n\nText')).toBe(
      '<!--\nauthor: x\n-->\n\n# Kurs\n\n# Einführung\n\nText'
    );
  });
  it('leaves fenced code blocks untouched', () => {
    const code = '```js\na\n   \n\n\nb\n```';
    expect(playerMarkdown(`# A\n\n${code}\n\n\n\nEnde`)).toBe(`# A\n\n${code}\n\nEnde`);
  });
  it('leaves a text without header alone (apart from whitespace lines)', () => {
    expect(playerMarkdown('# A\n  \nb')).toBe('# A\n\nb');
  });
});

describe('WerkbankDoc switch', () => {
  const turn = /** @type {const} */ ({ id: 't1', role: 'assistant', tier: 2, text: '' });
  const ctx = /** @type {any} */ ({ locale: 'de', getState: () => undefined, setState() {} });
  /** @param {string} kind */
  const doc = (kind) =>
    render(WerkbankDoc, {
      props: { part: { key: 'k', kind, title: 'S', turnId: 't1', text: MD }, turn, ctx }
    });

  it('only a module part offers Text | Kurs', () => {
    const sel = '[data-testid="werkbank-doc-course-switch"]';
    expect(doc('module').container.querySelector(sel)).toBeTruthy();
    expect(doc('lesson').container.querySelector(sel)).toBeNull();
  });

  it('the frame mounts only after the switch to Kurs', async () => {
    const view = doc('module');
    expect(view.container.querySelector('iframe')).toBeNull();
    (await view.findByTestId('werkbank-doc-course')).click();
    await waitFor(() => expect(view.container.querySelector('iframe')).toBeTruthy());
  });
});
