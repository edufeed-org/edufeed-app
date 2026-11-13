/** @vitest-environment jsdom */
// The window's model parts on a stand-in controller: the model button, the service divider, the
// lesson attachment notice, the wait card, the stop button and the one waiting message.
import { termiEnv, windowProps } from './termi-window-setup.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const fake = vi.hoisted(() => ({ make: /** @type {any} */ (null) }));
vi.mock('../termi-conversation.svelte.js', () => ({
  createConversation: (/** @type {any} */ deps) => fake.make(deps)
}));

import TermiChatWindow from '../TermiChatWindow.svelte';

const SAIA = {
  default: 'saia:glm-5.3',
  models: [
    { id: 'saia:glm-5.3', name: 'GLM 5.3', state: 'ready' },
    { id: 'saia:llama', name: 'Llama 4', state: 'ready' }
  ]
};
const OPUS = 'anthropic:claude-opus-5-5';
const OUTSIDE = { ...SAIA, external: { models: [{ id: OPUS, name: 'Claude Opus 5.5' }] } };

/** @type {any} */
let conv;
const noop = () => {};

/** The controller's surface the window reads; `s` drives it. @param {any} deps */
function makeConv(deps) {
  const s = $state({
    turns: /** @type {any[]} */ ([]),
    status: 'ready',
    models: /** @type {any} */ (SAIA),
    choice: /** @type {string | null} */ (null),
    outsideOk: false,
    waiting: /** @type {any} */ (null),
    task: 'ask'
  });
  const chat = {
    get status() {
      return s.status;
    },
    get messages() {
      return [];
    }
  };
  const busy = () => s.status === 'submitted' || s.status === 'streaming';
  const own = {
    s,
    deps,
    get turns() {
      return s.turns;
    },
    get assistant() {
      return { chat };
    },
    get task() {
      return s.task;
    },
    get models() {
      return s.models;
    },
    get choice() {
      return s.choice;
    },
    get outsideOk() {
      return s.outsideOk;
    },
    get waiting() {
      return s.waiting;
    },
    get chatBusy() {
      return busy();
    },
    lessonState: null,
    botTyping: false,
    history: null,
    historyReady: Promise.resolve(),
    suggestions: [],
    chatError: undefined,
    inflight: Promise.resolve(),
    ask: vi.fn((/** @type {string} */ q) => {
      if (busy()) return false;
      s.turns = [...s.turns, { id: `u${s.turns.length}`, role: 'user', tier: 2, text: q }];
      s.status = 'submitted';
      return true;
    }),
    stop: vi.fn(async () => {
      s.status = 'ready';
    }),
    switchTo: vi.fn(async () => {}),
    setChoice: vi.fn((/** @type {string | null} */ id) => (s.choice = id)),
    setOutsideOk: vi.fn(() => (s.outsideOk = true)),
    refreshModels: vi.fn(async () => {}),
    newConversation: vi.fn(() => deps.onRestart?.()),
    connectHistory: () => noop,
    assistantAllowed: async () => true,
    conversationId: () => 'c1',
    turnsNow: () => [],
    retryOf: () => undefined
  };
  return new Proxy(own, {
    get: (t, k) => (k in t ? /** @type {any} */ (t)[k] : typeof k === 'string' ? noop : undefined)
  });
}
fake.make = (/** @type {any} */ deps) => (conv = makeConv(deps));

const renderWindow = () => render(TermiChatWindow, { props: windowProps() });
/** @param {ReturnType<typeof renderWindow>} view @param {string} text */
async function enter(view, text) {
  const input = view.getByTestId('termi-input');
  await fireEvent.input(input, { target: { value: text } });
  await fireEvent.keyDown(input, { key: 'Enter' });
}
/** @param {string} id @param {string} model */
const answer = (id, model) => ({ id, role: 'assistant', tier: 2, text: `Antwort ${id}`, model });

beforeEach(() => {
  termiEnv.config.termi = { enabled: true, embed: true, llm: true };
});
afterEach(() => vi.useRealTimers());

describe('model button and outside state in the window', () => {
  it('the button sits under the composer when there is something to choose', async () => {
    const view = renderWindow();
    const button = await view.findByTestId('termi-model-button');
    expect(button.textContent).toContain('Antwort von SAIA (GWDG) · GLM 5.3');
  });

  it('one SAIA model, no outside group: no button and nothing about outside models', async () => {
    const view = renderWindow();
    conv.s.models = { default: 'saia:glm-5.3', models: [SAIA.models[0]] };
    await tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(view.queryByTestId('termi-model-button')).toBeNull();
    expect(view.container.textContent).not.toContain('Anthropic');
  });

  it('a divider where the answering service changes, derived from the turns', async () => {
    const view = renderWindow();
    conv.s.models = OUTSIDE;
    conv.s.turns = [
      { id: 'u1', role: 'user', tier: 2, text: 'Frage' },
      answer('a1', 'saia:glm-5.3'),
      { id: 'u2', role: 'user', tier: 2, text: 'Frage 2' },
      answer('a2', 'saia:llama'),
      { id: 'u3', role: 'user', tier: 2, text: 'Frage 3' },
      answer('a3', OPUS),
      answer('a4', 'saia:glm-5.3')
    ];
    await tick();
    const dividers = view.getAllByTestId('termi-model-divider').map((d) => d.textContent?.trim());
    expect(dividers).toEqual([
      m.termi_model_divider_outside({ model: 'Claude Opus 5.5' }),
      m.termi_model_divider_saia({ model: 'GLM 5.3' })
    ]);
    // the model line under an answer uses the labels
    expect(view.getAllByTestId('termi-model')[2].textContent?.trim()).toBe(
      'Claude Opus 5.5 · Anthropic (USA)'
    );
  });

  it('lesson attachment: names Anthropic while an outside model is chosen; the import notice always names GWDG', async () => {
    const view = renderWindow();
    conv.s.models = OUTSIDE;
    conv.s.outsideOk = true;
    conv.s.choice = OPUS;
    conv.s.task = 'lesson';
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    await fireEvent.change(view.getByTestId('termi-file-input'), { target: { files: [file] } });
    const chip = await view.findByTestId('termi-attachment');
    expect(chip.textContent).toContain(m.termi_outside_attach_hint());
    conv.s.task = 'ask';
    await tick();
    expect(chip.textContent).toContain(m.termi_import_chip_hint());
    expect(chip.textContent).not.toContain('Anthropic');
  });
});

describe('waiting, stop and the waiting message', () => {
  it('the wait card on `waiting`: model, next, seconds; "Jetzt wechseln" switches, "Abbrechen" stops', async () => {
    const view = renderWindow();
    conv.s.status = 'streaming';
    conv.s.waiting = { model: 'saia:glm-5.3', next: 'saia:llama' };
    const card = await view.findByTestId('termi-wait');
    expect(card.getAttribute('role')).toBe('status');
    expect(card.textContent).toContain(m.termi_wait_title({ model: 'GLM 5.3' }));
    expect(card.textContent).toContain(m.termi_wait_body({ seconds: 20, next: 'Llama 4' }));
    await fireEvent.click(within(card).getByText(m.termi_wait_switch()));
    expect(conv.switchTo).toHaveBeenCalledWith('saia:llama');
    await fireEvent.click(within(card).getByText(m.common_cancel()));
    expect(conv.stop).toHaveBeenCalled();
  });

  it('the countdown is computed once (a status region must not re-announce); a new model recomputes', async () => {
    vi.useFakeTimers();
    const view = renderWindow();
    conv.s.status = 'streaming';
    conv.s.waiting = { model: 'saia:glm-5.3', next: 'saia:llama' };
    await tick();
    const text = () => view.getByTestId('termi-wait').textContent;
    expect(text()).toContain(m.termi_wait_body({ seconds: 20, next: 'Llama 4' }));
    vi.advanceTimersByTime(12_000);
    await tick();
    expect(text()).toContain(m.termi_wait_body({ seconds: 20, next: 'Llama 4' }));
    conv.s.waiting = { model: 'saia:llama' };
    await tick();
    expect(text()).toContain(m.termi_wait_body_last({ seconds: 80 }));
  });

  it('the last candidate: no "Jetzt wechseln", the longer cut', async () => {
    const view = renderWindow();
    conv.s.status = 'streaming';
    conv.s.waiting = { model: 'saia:glm-5.3' };
    const card = await view.findByTestId('termi-wait');
    expect(card.textContent).toContain(m.termi_wait_body_last({ seconds: 80 }));
    expect(within(card).queryByText(m.termi_wait_switch())).toBeNull();
  });

  it('no model list: the card shows, but offers no switch', async () => {
    const view = renderWindow();
    conv.s.models = null;
    conv.s.status = 'streaming';
    conv.s.waiting = { model: 'saia:glm-5.3', next: 'saia:llama' };
    const card = await view.findByTestId('termi-wait');
    expect(within(card).queryByText(m.termi_wait_switch())).toBeNull();
  });

  it('`submitted` for 8 s: the card for the chosen model and its next candidate', async () => {
    vi.useFakeTimers();
    const view = renderWindow();
    conv.s.status = 'submitted';
    await tick();
    vi.advanceTimersByTime(7_000);
    await tick();
    expect(view.queryByTestId('termi-wait')).toBeNull();
    vi.advanceTimersByTime(1_000);
    await tick();
    const card = view.getByTestId('termi-wait');
    expect(card.textContent).toContain(m.termi_wait_title({ model: 'GLM 5.3' }));
    expect(within(card).getByText(m.termi_wait_switch())).toBeTruthy();
    conv.s.status = 'streaming';
    await tick();
    expect(view.queryByTestId('termi-wait')).toBeNull();
  });

  it('while an answer runs the send button is a stop button', async () => {
    const view = renderWindow();
    expect(view.queryByTestId('termi-stop')).toBeNull();
    conv.s.status = 'streaming';
    await tick();
    expect(view.queryByTestId('termi-send')).toBeNull();
    const stop = view.getByTestId('termi-stop');
    expect(stop.getAttribute('aria-label')).toBe(m.termi_stop_aria());
    await fireEvent.click(stop);
    expect(conv.stop).toHaveBeenCalled();
  });

  it('a message sent while busy waits (one; a second replaces it) and goes out when idle', async () => {
    const view = renderWindow();
    conv.s.status = 'streaming';
    await tick();
    await enter(view, 'Erste');
    await enter(view, 'Zweite');
    const queued = view.getAllByTestId('termi-queued');
    expect(queued).toHaveLength(1);
    expect(queued[0].textContent).toContain('Zweite');
    expect(queued[0].textContent).toContain(m.termi_queue_waiting());
    expect(/** @type {HTMLTextAreaElement} */ (view.getByTestId('termi-input')).value).toBe('');
    expect(conv.ask).not.toHaveBeenCalled();
    conv.s.status = 'ready';
    await waitFor(() => expect(conv.ask).toHaveBeenCalledWith('Zweite'));
    expect(view.queryByTestId('termi-queued')).toBeNull();
  });

  it('"Zurücknehmen" puts the text back into the composer', async () => {
    const view = renderWindow();
    conv.s.status = 'streaming';
    await tick();
    await enter(view, 'Doch nicht');
    await fireEvent.click(view.getByText(m.termi_queue_take_back()));
    expect(view.queryByTestId('termi-queued')).toBeNull();
    expect(/** @type {HTMLTextAreaElement} */ (view.getByTestId('termi-input')).value).toBe(
      'Doch nicht'
    );
    conv.s.status = 'ready';
    await tick();
    expect(conv.ask).not.toHaveBeenCalled();
  });

  it('stop and a new conversation drop the waiting message', async () => {
    const view = renderWindow();
    conv.s.status = 'streaming';
    await tick();
    await enter(view, 'Weg damit');
    await fireEvent.click(view.getByTestId('termi-stop'));
    await tick();
    expect(view.queryByTestId('termi-queued')).toBeNull();
    expect(conv.ask).not.toHaveBeenCalled();

    conv.s.status = 'streaming';
    await tick();
    await enter(view, 'Auch weg');
    expect(view.getByTestId('termi-queued')).toBeTruthy();
    conv.newConversation();
    await tick();
    expect(view.queryByTestId('termi-queued')).toBeNull();
    conv.s.status = 'ready';
    await tick();
    expect(conv.ask).not.toHaveBeenCalled();
  });
});
