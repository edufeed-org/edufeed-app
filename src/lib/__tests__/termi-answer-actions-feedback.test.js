/** @vitest-environment jsdom */
// The two thumbs under a rateable answer, through the answer-action contract.
import { describe, it, expect, vi } from 'vitest';
import {
  ANSWER_ACTIONS,
  actionsFor,
  runAnswerAction
} from '../components/assistant/answer-actions.js';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

/** @type {any} */
const answer = { id: 'a1', role: 'assistant', text: 'Antwort', tier: 2, model: 'saia:glm-5.3' };
/** @type {any} */
const canned = { id: 'c1', role: 'assistant', text: 'Hier entlang', tier: 1 };
const up = /** @type {any} */ (ANSWER_ACTIONS.find((a) => a.id === 'feedback_up'));
const down = /** @type {any} */ (ANSWER_ACTIONS.find((a) => a.id === 'feedback_down'));

function makeCtx(feedback = { send: vi.fn(async () => {}), open: vi.fn() }) {
  const states = new Map();
  return /** @type {any} */ ({
    user: null,
    locale: 'de',
    close: () => {},
    getState: (/** @type {string} */ t, /** @type {string} */ a) => states.get(`${t}:${a}`),
    setState: (/** @type {string} */ t, /** @type {string} */ a, /** @type {any} */ s) =>
      states.set(`${t}:${a}`, s),
    setArtifacts: () => {},
    feedback
  });
}
const ids = (/** @type {any} */ turn, /** @type {any} */ ctx) =>
  actionsFor(turn, ctx)
    .map((a) => a.id)
    .filter((id) => id.startsWith('feedback'));

describe('feedback answer actions', () => {
  it('none without ctx.feedback (feature off)', () => {
    expect(ids(answer, makeCtx(/** @type {any} */ (null)))).toEqual([]);
  });

  it('both on a rateable turn, for an anonymous user too; none on a canned turn', () => {
    const ctx = makeCtx();
    expect(ids(answer, ctx)).toEqual(['feedback_up', 'feedback_down']);
    expect(ids(canned, ctx)).toEqual([]);
  });

  it('are quiet text buttons with a label per state', () => {
    const ctx = makeCtx();
    expect(up?.ghost && down?.ghost).toBe(true);
    expect(up?.label(ctx)).toBe('👍 Hilfreich');
    expect(down?.label(ctx)).toBe('👎 Nicht hilfreich');
    expect(up?.label(ctx, { ok: true })).toBe('👍 Danke');
    expect(down?.label(ctx, { ok: true })).toBe('👎 Danke');
    expect(up?.label(ctx, { failed: true })).toBe('Senden fehlgeschlagen – nochmal');
  });

  it('thumbs up sends metadata only, unnamed, and ends as sent', async () => {
    const ctx = makeCtx();
    ctx.setState('a1', 'feedback_down', { ok: true });
    await runAnswerAction(answer, up, ctx);
    expect(ctx.feedback.send).toHaveBeenCalledWith(answer, {
      vote: 'up',
      attach: false,
      named: false
    });
    expect(ctx.getState('a1', 'feedback_up')).toEqual({ ok: true });
    // the later vote counts: the other thumb is no longer lit
    expect(ctx.getState('a1', 'feedback_down')).toBeUndefined();
  });

  it('thumbs down opens the dialog and sends nothing', async () => {
    const ctx = makeCtx();
    await runAnswerAction(answer, down, ctx);
    expect(ctx.feedback.open).toHaveBeenCalledWith(answer);
    expect(ctx.feedback.send).not.toHaveBeenCalled();
    expect(ctx.getState('a1', 'feedback_down')).toBeUndefined();
  });

  it('a second click while the first is on its way sends once', async () => {
    /** @type {() => void} */
    let release = () => {};
    const send = vi.fn(() => new Promise((r) => (release = () => r(undefined))));
    const ctx = makeCtx({ send, open: vi.fn() });
    const first = runAnswerAction(answer, up, ctx);
    await runAnswerAction(answer, up, ctx);
    release();
    await first;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a click on an already sent thumbs up sends nothing more', async () => {
    const ctx = makeCtx();
    await runAnswerAction(answer, up, ctx);
    await runAnswerAction(answer, up, ctx);
    expect(ctx.feedback.send).toHaveBeenCalledTimes(1);
    expect(ctx.getState('a1', 'feedback_up')).toEqual({ ok: true });
  });

  it('a failed send shows the failure, and a retry sends again', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('relay down'))
      .mockResolvedValue(undefined);
    const ctx = makeCtx({ send, open: vi.fn() });
    await runAnswerAction(answer, up, ctx);
    expect(ctx.getState('a1', 'feedback_up')).toEqual({ failed: true });
    await runAnswerAction(answer, up, ctx);
    expect(send).toHaveBeenCalledTimes(2);
    expect(ctx.getState('a1', 'feedback_up')).toEqual({ ok: true });
  });
});
