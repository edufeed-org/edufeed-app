/** @vitest-environment jsdom */
// The model button under the composer: label, menu (statuses as text, keyboard), the outside group
// and its one-time confirm, the outside notice. The controller is a stand-in with the same surface.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import ModelButton from '../ModelButton.svelte';

overwriteGetLocale(() => 'de');

const SAIA = {
  default: 'saia:glm-5.3',
  models: [
    { id: 'saia:glm-5.3', name: 'GLM 5.3', state: 'ready' },
    { id: 'saia:llama', name: 'Llama 4', state: 'busy' },
    { id: 'saia:qwen', name: 'Qwen 3', state: 'down' }
  ]
};
const OPUS = 'anthropic:claude-opus-5-5';
const OUTSIDE = {
  ...SAIA,
  external: { models: [{ id: OPUS, name: 'Claude Opus 5.5' }], left: 12, total: 20 }
};

/** @param {any} models @param {{ choice?: string | null, outsideOk?: boolean }} [init] */
function fakeConv(models, { choice = null, outsideOk = false } = {}) {
  const s = $state({ models, choice, outsideOk });
  /** @type {string[]} */
  const calls = [];
  return {
    calls,
    get models() {
      return s.models;
    },
    get choice() {
      return s.choice;
    },
    get outsideOk() {
      return s.outsideOk;
    },
    setChoice: vi.fn((/** @type {string | null} */ id) => {
      calls.push(`choice:${id}`);
      s.choice = id;
    }),
    setOutsideOk: vi.fn(() => {
      calls.push('outsideOk');
      s.outsideOk = true;
    }),
    refreshModels: vi.fn(async () => {})
  };
}

/** @param {ReturnType<typeof fakeConv>} conv */
const renderButton = (conv) => render(ModelButton, { props: { conv: /** @type {any} */ (conv) } });
/** @param {ReturnType<typeof renderButton>} view */
const button = (view) => view.getByTestId('termi-model-button');
/** @param {ReturnType<typeof renderButton>} view */
async function openMenu(view) {
  await fireEvent.click(button(view));
  return view.getByRole('menu');
}

afterEach(() => vi.unstubAllGlobals());

describe('ModelButton', () => {
  it('names service and model; no status mark while the chosen model is ready', () => {
    const view = renderButton(fakeConv(SAIA));
    expect(button(view).textContent).toContain('Antwort von SAIA (GWDG) · GLM 5.3');
    expect(button(view).textContent).not.toContain(m.termi_model_state_ready());
    expect(button(view).className).not.toContain('btn-warning');
  });

  it('a busy or down choice adds its status as text', () => {
    const busy = renderButton(fakeConv(SAIA, { choice: 'saia:llama' }));
    expect(button(busy).textContent).toContain(m.termi_model_state_busy());
    busy.unmount();
    const down = renderButton(fakeConv(SAIA, { choice: 'saia:qwen' }));
    expect(button(down).textContent).toContain(m.termi_model_state_down());
  });

  it('nothing to choose (one SAIA model, no outside group) or no list: no button', () => {
    const one = { default: 'saia:glm-5.3', models: [SAIA.models[0]] };
    expect(renderButton(fakeConv(one)).queryByTestId('termi-model-button')).toBeNull();
    expect(renderButton(fakeConv(null)).queryByTestId('termi-model-button')).toBeNull();
  });

  it('the menu: every SAIA model with its status as text, the default tag, the footer; it reloads the list', async () => {
    const conv = fakeConv(SAIA);
    const view = renderButton(conv);
    const menu = await openMenu(view);
    expect(conv.refreshModels).toHaveBeenCalled();
    expect(button(view).getAttribute('aria-expanded')).toBe('true');
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('GLM 5.3');
    expect(items[0].textContent).toContain(m.termi_model_state_ready());
    expect(items[0].textContent).toContain(m.termi_model_default());
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    expect(items[1].textContent).toContain(m.termi_model_state_busy());
    expect(items[2].textContent).toContain(m.termi_model_state_down());
    expect(menu.textContent).toContain(m.termi_model_menu_footer());
  });

  it('an account without `external`: nothing about outside models in the DOM', async () => {
    const view = renderButton(fakeConv(SAIA));
    await openMenu(view);
    expect(view.container.textContent).not.toContain('Anthropic');
    expect(view.queryByText(m.termi_outside_group_title())).toBeNull();
  });

  it('choosing a SAIA model stores it and closes the menu', async () => {
    const conv = fakeConv(SAIA);
    const view = renderButton(conv);
    const menu = await openMenu(view);
    await fireEvent.click(within(menu).getAllByRole('menuitemradio')[1]);
    expect(conv.setChoice).toHaveBeenCalledWith('saia:llama');
    expect(view.queryByRole('menu')).toBeNull();
    expect(button(view).textContent).toContain('Llama 4');
  });

  it('keyboard: arrows move (wrapping), Escape closes and returns focus to the button', async () => {
    const conv = fakeConv(SAIA);
    const view = renderButton(conv);
    const menu = await openMenu(view);
    const items = within(menu).getAllByRole('menuitemradio');
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    await fireEvent.keyDown(menu, { key: 'ArrowUp' });
    await fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]); // wraps
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const stopped = vi.spyOn(esc, 'stopPropagation');
    menu.dispatchEvent(esc);
    await waitFor(() => expect(view.queryByRole('menu')).toBeNull());
    // stopped: Escape never reaches the window's (delegated) handler, which would close Termi
    expect(stopped).toHaveBeenCalled();
    expect(document.activeElement).toBe(button(view));
    expect(conv.setChoice).not.toHaveBeenCalled();
  });

  it('the outside group: what goes to Anthropic and the steps left today', async () => {
    const view = renderButton(fakeConv(OUTSIDE));
    const menu = await openMenu(view);
    expect(menu.textContent).toContain(m.termi_outside_group_title());
    expect(menu.textContent).toContain(m.termi_outside_group_body());
    expect(menu.textContent).toContain('Heute noch 12 von 20 Schritten.');
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(4);
  });

  it('first outside choice: the confirm; "Abbrechen" keeps the old choice', async () => {
    const conv = fakeConv(OUTSIDE);
    const view = renderButton(conv);
    const menu = await openMenu(view);
    await fireEvent.click(within(menu).getByText('Claude Opus 5.5'));
    const dialog = await view.findByTestId('termi-outside-confirm');
    expect(dialog.textContent).toContain(
      m.termi_outside_confirm_title({ model: 'Claude Opus 5.5' })
    );
    expect(dialog.textContent).toContain(m.termi_outside_confirm_questions());
    expect(dialog.textContent).toContain(m.termi_outside_confirm_quota({ total: 20 }));
    await fireEvent.click(within(dialog).getByText(m.common_cancel()));
    expect(view.queryByTestId('termi-outside-confirm')).toBeNull();
    expect(conv.setChoice).not.toHaveBeenCalled();
    expect(conv.setOutsideOk).not.toHaveBeenCalled();
    expect(button(view).textContent).toContain('GLM 5.3');
  });

  it('confirming: outsideOk first, then the choice; amber button and the notice line; "Zurück zur GWDG" resets', async () => {
    const conv = fakeConv(OUTSIDE);
    const view = renderButton(conv);
    const menu = await openMenu(view);
    await fireEvent.click(within(menu).getByText('Claude Opus 5.5'));
    const dialog = await view.findByTestId('termi-outside-confirm');
    await fireEvent.click(
      within(dialog).getByText(m.termi_outside_confirm_use({ model: 'Claude Opus 5.5' }))
    );
    expect(conv.calls).toEqual(['outsideOk', `choice:${OPUS}`]);
    expect(button(view).textContent).toContain('Antwort von Anthropic (USA) · Claude Opus 5.5');
    expect(button(view).className).toContain('btn-warning');
    const notice = view.getByTestId('termi-outside-notice');
    expect(notice.textContent).toContain(m.termi_outside_notice());
    await fireEvent.click(within(notice).getByText(m.termi_outside_back()));
    expect(conv.setChoice).toHaveBeenLastCalledWith(null);
    expect(view.queryByTestId('termi-outside-notice')).toBeNull();
    expect(button(view).textContent).toContain('GLM 5.3');
  });

  it('confirmed once on this device: an outside choice needs no second confirm', async () => {
    const conv = fakeConv(OUTSIDE, { outsideOk: true });
    const view = renderButton(conv);
    const menu = await openMenu(view);
    await fireEvent.click(within(menu).getByText('Claude Opus 5.5'));
    expect(conv.setChoice).toHaveBeenCalledWith(OPUS);
    expect(view.queryByTestId('termi-outside-confirm')).toBeNull();
  });

  it('on a phone the menu opens in a bottom sheet', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const view = renderButton(fakeConv(SAIA));
    await fireEvent.click(button(view));
    const sheet = view.getByTestId('termi-model-sheet');
    expect(within(sheet).getAllByRole('menuitemradio')).toHaveLength(3);
  });
});
