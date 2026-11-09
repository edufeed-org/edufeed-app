/** @vitest-environment jsdom */
// File import: a dropped or picked file becomes an attachment chip; only
// Send reads it and POSTs the text (+ the typed instruction) to
// /api/termi/extract, then the preview shows.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const SK = generateSecretKey();
const user = vi.hoisted(() => ({ current: /** @type {any} */ (null) }));
const eligible = vi.hoisted(() => ({ value: true }));
const extractText = vi.hoisted(() => vi.fn());

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return { enabled: false, handleDomain: 'edufeed.org' };
    },
    get help() {
      return { url: '/wiki/edufeed-erste-schritte' };
    },
    get termi() {
      return { enabled: true, embed: true, llm: true };
    },
    get discover() {
      return { contentTypes: ['events', 'learning'] };
    }
  }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => user.current }));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));
vi.mock('$lib/helpers/run-create-action.js', () => ({ runCreateAction: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  eventStore: { getReplaceable: () => undefined }
}));
vi.mock('$lib/helpers/calendar-import/index.js', async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  extractText: (/** @type {any[]} */ ...a) => extractText(...a)
}));

import TermiChatWindow from '../TermiChatWindow.svelte';
import { _resetTermiEligibilityForTests } from '../termi-router.js';

/** @type {import('vitest').Mock} */
let fetchMock;

beforeEach(() => {
  _resetTermiEligibilityForTests();
  eligible.value = true;
  user.current = {
    pubkey: getPublicKey(SK),
    type: 'nsec',
    signer: { signEvent: async (/** @type {any} */ d) => finalizeEvent(d, SK) }
  };
  extractText.mockReset();
  extractText.mockResolvedValue({
    text: 'Elternabend 01.12. 19 Uhr',
    kind: 'zip',
    truncated: false
  });
  fetchMock = vi.fn(async (/** @type {string} */ url) => {
    if (url.startsWith('/api/termi/eligible')) {
      return new Response(JSON.stringify({ eligible: eligible.value, gated: true }));
    }
    if (url === '/api/termi/extract') {
      return new Response(
        JSON.stringify({
          events: [{ title: 'Elternabend', startDate: '2026-12-01', startTime: '19:00' }]
        })
      );
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderWindow() {
  return render(TermiChatWindow, {
    props: {
      onToggleExpand: () => {},
      onClose: () => {},
      hints: [],
      openCount: 0,
      runHint: vi.fn(),
      customizeHint: vi.fn(),
      dismissHint: vi.fn()
    }
  });
}

/** @param {ReturnType<typeof renderWindow>} view @param {File} file */
async function drop(view, file) {
  await fireEvent.drop(view.getByTestId('termi-window'), {
    dataTransfer: { files: [file], types: ['Files'] }
  });
}

const extractCalls = () => fetchMock.mock.calls.filter((c) => c[0] === '/api/termi/extract');
const xlsx = () => new File(['xx'], 'x.xlsx');

/** @param {ReturnType<typeof renderWindow>} view @param {string} text */
async function send(view, text) {
  await fireEvent.input(view.getByTestId('termi-input'), { target: { value: text } });
  await fireEvent.click(view.getByTestId('termi-send'));
}

describe('TermiChatWindow file import', () => {
  it('a drop puts an attachment chip above the composer; nothing is read or sent', async () => {
    const view = renderWindow();
    await drop(view, xlsx());
    const chip = await waitFor(() => view.getByTestId('termi-attachment'));
    expect(chip.textContent).toContain('x.xlsx');
    expect(chip.textContent).toContain('GWDG');
    // inside the composer form
    expect(chip.closest('form')).toBe(view.getByTestId('termi-input').closest('form'));
    expect(extractText).not.toHaveBeenCalled();
    expect(extractCalls()).toHaveLength(0);
  });

  it('a second file replaces the attachment', async () => {
    const view = renderWindow();
    await drop(view, xlsx());
    await waitFor(() => view.getByTestId('termi-attachment'));
    await drop(view, new File(['y'], 'plan.pdf'));
    await waitFor(() =>
      expect(view.getByTestId('termi-attachment').textContent).toContain('plan.pdf')
    );
    expect(view.getAllByTestId('termi-attachment')).toHaveLength(1);
  });

  it('× removes the chip and nothing is sent', async () => {
    const view = renderWindow();
    await drop(view, xlsx());
    await waitFor(() => view.getByRole('button', { name: 'Datei entfernen' }));
    await fireEvent.click(view.getByRole('button', { name: 'Datei entfernen' }));
    expect(view.queryByTestId('termi-attachment')).toBeNull();
    await fireEvent.click(view.getByTestId('termi-send'));
    expect(extractText).not.toHaveBeenCalled();
    expect(extractCalls()).toHaveLength(0);
  });

  it('Send with text: the text is the user bubble and goes along as instruction', async () => {
    const view = renderWindow();
    await drop(view, xlsx());
    await waitFor(() => view.getByTestId('termi-attachment'));
    await send(view, '  Nur die Elternabende, bitte  ');
    await waitFor(() => expect(view.getAllByTestId('termi-import-row')).toHaveLength(1));
    expect(view.getByText('Nur die Elternabende, bitte')).toBeTruthy();
    expect(view.queryByTestId('termi-attachment')).toBeNull();
    expect(extractText).toHaveBeenCalledTimes(1);
    expect(extractCalls()).toHaveLength(1);
    const init = /** @type {RequestInit} */ (extractCalls()[0][1]);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      text: 'Elternabend 01.12. 19 Uhr',
      filename: 'x.xlsx',
      locale: 'de',
      instruction: 'Nur die Elternabende, bitte'
    });
    expect(/** @type {any} */ (init.headers).Authorization).toMatch(/^Nostr /);
    expect(view.getByRole('button', { name: '1 Termine öffentlich veröffentlichen' })).toBeTruthy();
  });

  it('Send (Enter) with empty text: the default prompt bubble, no instruction', async () => {
    const view = renderWindow();
    await drop(view, xlsx());
    await waitFor(() => view.getByTestId('termi-attachment'));
    await fireEvent.keyDown(view.getByTestId('termi-input'), { key: 'Enter' });
    await waitFor(() => expect(view.getAllByTestId('termi-import-row')).toHaveLength(1));
    expect(view.getByText('Termine aus x.xlsx übernehmen')).toBeTruthy();
    const body = JSON.parse(String(/** @type {RequestInit} */ (extractCalls()[0][1]).body));
    expect(body).not.toHaveProperty('instruction');
  });

  it('a 429 from the extract route shows the quota line, no retry', async () => {
    fetchMock.mockImplementation(async (/** @type {string} */ url) => {
      if (url.startsWith('/api/termi/eligible')) {
        return new Response(JSON.stringify({ eligible: true, gated: true }));
      }
      return new Response(JSON.stringify({ error: 'quota', scope: 'user' }), { status: 429 });
    });
    const view = renderWindow();
    await drop(view, xlsx());
    await waitFor(() => view.getByTestId('termi-attachment'));
    await send(view, '');
    await waitFor(() => view.getByText('Dein Termi-Kontingent ist für heute aufgebraucht.'));
    expect(view.queryByText(/Die Erkennung ist fehlgeschlagen/)).toBeNull();
    expect(view.queryByTestId('termi-import-retry')).toBeNull();
  });

  it('a failed extraction offers a retry that sends again', async () => {
    let fail = true;
    fetchMock.mockImplementation(async (/** @type {string} */ url) => {
      if (url.startsWith('/api/termi/eligible')) {
        return new Response(JSON.stringify({ eligible: true, gated: true }));
      }
      if (fail) return new Response('{}', { status: 502 });
      return new Response(JSON.stringify({ events: [{ title: 'A', startDate: '2026-12-01' }] }));
    });
    const view = renderWindow();
    await drop(view, xlsx());
    await waitFor(() => view.getByTestId('termi-attachment'));
    await send(view, 'nur Dezember');
    await waitFor(() => view.getByText(/Die Erkennung ist fehlgeschlagen/));
    fail = false;
    await fireEvent.click(view.getByTestId('termi-import-retry'));
    await waitFor(() => expect(view.getAllByTestId('termi-import-row')).toHaveLength(1));
    const bodies = extractCalls().map((c) => JSON.parse(String(c[1].body)));
    expect(bodies.map((b) => b.instruction)).toEqual(['nur Dezember', 'nur Dezember']);
  });

  it('empty text → the no-text line, no request', async () => {
    extractText.mockResolvedValue({ text: '', kind: 'pdf', truncated: false });
    const view = renderWindow();
    await drop(view, new File(['x'], 'scan.pdf'));
    await waitFor(() => view.getByTestId('termi-attachment'));
    await send(view, '');
    await waitFor(() => view.getByText(/Keine Textinhalte gefunden/));
    expect(extractCalls()).toHaveLength(0);
  });

  it('logged out → needs the assistant', async () => {
    user.current = null;
    const view = renderWindow();
    await drop(view, xlsx());
    await waitFor(() => view.getByText(/Dafür brauchst du den KI-Assistenten/));
    expect(view.queryByTestId('termi-attachment')).toBeNull();
  });

  it('not eligible → needs the assistant', async () => {
    eligible.value = false;
    const view = renderWindow();
    await drop(view, xlsx());
    await waitFor(() => view.getByText(/Dafür brauchst du den KI-Assistenten/));
    expect(view.queryByTestId('termi-attachment')).toBeNull();
  });

  it('a 3 MB file is refused', async () => {
    const big = new File([new Uint8Array(3 * 1024 * 1024)], 'big.pdf');
    const view = renderWindow();
    await drop(view, big);
    await waitFor(() => view.getByText('Die Datei ist größer als 2 MB.'));
    expect(view.queryByTestId('termi-attachment')).toBeNull();
  });

  it('the paperclip input accepts PDFs and spreadsheets', () => {
    const view = renderWindow();
    const accept = view.getByTestId('termi-file-input').getAttribute('accept') ?? '';
    expect(accept).toContain('.pdf');
    expect(accept).toContain('.xlsx');
    expect(view.getByRole('button', { name: 'Datei anhängen' })).toBeTruthy();
  });
});
