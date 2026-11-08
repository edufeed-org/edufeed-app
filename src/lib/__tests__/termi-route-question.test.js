/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { routeQuestion } from '$lib/components/assistant/termi-router.js';

/** @param {any} answer matches, or an HTTP status */
const fetchWith = (answer) =>
  /** @type {any} */ (
    vi.fn(async () =>
      typeof answer === 'number'
        ? new Response('', { status: answer })
        : new Response(JSON.stringify({ matches: answer }))
    )
  );

describe('routeQuestion guesses', () => {
  it('keyword path: the best weak matches, at most two', async () => {
    const { decision, guesses } = await routeQuestion('hab ich neue nachrichten?', {
      locale: 'de',
      fetch: fetchWith(503),
      ctx: { loggedIn: true }
    });
    expect(decision.kind).toBe('none');
    expect(guesses[0]).toBe('inbox');
    expect(guesses.length).toBeLessThanOrEqual(2);
  });

  it('embed path: only matches at or above the embed MAYBE threshold', async () => {
    const { guesses } = await routeQuestion('x', {
      locale: 'de',
      fetch: fetchWith([
        { skill: 'home', score: 0.2 },
        { skill: 'inbox', score: 0.75 }
      ]),
      ctx: { loggedIn: true }
    });
    expect(guesses).toEqual(['inbox']);
  });

  it('skills the user cannot use are no guess', async () => {
    const { guesses } = await routeQuestion('x', {
      locale: 'de',
      fetch: fetchWith([{ skill: 'inbox', score: 0.75 }]),
      ctx: { loggedIn: false }
    });
    expect(guesses).toEqual([]);
  });
});
