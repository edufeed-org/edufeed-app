/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { routeQuestion, searchContent } from '$lib/components/assistant/termi-router.js';

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
  it('keyword path: only strong matches near the best one', async () => {
    const { decision, guesses, strongGuesses } = await routeQuestion('hab ich neue nachrichten?', {
      locale: 'de',
      fetch: fetchWith(503),
      ctx: { loggedIn: true }
    });
    expect(decision.kind).toBe('none');
    // create.* share one token (0.33): no guess.
    expect(guesses).toEqual(['inbox']);
    // A 0.67 partial phrase: fine for an empty answer, never above real cards.
    expect(strongGuesses).toEqual([]);
  });

  it('keyword path: a 0.5 partial (q4) guesses for an empty answer only', async () => {
    const { guesses, strongGuesses } = await routeQuestion(
      'ich suche nach Unterrichtsentwürfen zum Thema Nachhaltigkeit',
      { locale: 'de', fetch: fetchWith(503), ctx: { loggedIn: true } }
    );
    expect(guesses.length).toBeGreaterThan(0);
    expect(strongGuesses).toEqual([]);
  });

  it('embed path: only matches at or above the embed MAYBE threshold', async () => {
    const { guesses, strongGuesses } = await routeQuestion('x', {
      locale: 'de',
      fetch: fetchWith([
        { skill: 'home', score: 0.2 },
        { skill: 'inbox', score: 0.75 }
      ]),
      ctx: { loggedIn: true }
    });
    expect(guesses).toEqual(['inbox']);
    expect(strongGuesses).toEqual(['inbox']);
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

describe('searchContent', () => {
  it('a failed request reports the search as unavailable (retry line), not "nothing found"', async () => {
    for (const fetch of [
      fetchWith(429),
      fetchWith(502),
      /** @type {any} */ (vi.fn(async () => Promise.reject(new Error('timeout'))))
    ]) {
      expect(await searchContent('x', { locale: 'de', fetch })).toEqual({
        items: [],
        sourcesUnavailable: ['search']
      });
    }
  });
});
