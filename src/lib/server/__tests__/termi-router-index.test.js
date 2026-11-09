/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRouterIndex, NotReadyError } from '../termi/router-index.js';
import { embedTexts } from '../termi/embed.js';

/** @type {Array<{ id: string, phrases: { de: string[], en: string[] } }>} */
const SKILLS = [
  { id: 'home', phrases: { de: ['Zur Startseite', 'Startseite öffnen'], en: ['Go home'] } },
  { id: 'calendar', phrases: { de: ['Zeig den Kalender'], en: ['Show the calendar'] } }
];

/**
 * A unit vector along axis `i` of a space with `dims` dimensions.
 * @param {number} i
 * @param {number} [dims]
 */
function axisVector(i, dims = 4) {
  return Array.from({ length: dims }, (_, j) => (j === i ? 1 : 0));
}

/**
 * Fake embed: deterministic per input phrase/text so dot products are
 * predictable. Every phrase containing "calendar"/"Kalender" gets axis 1,
 * everything else axis 0 — query text follows the same rule.
 */
function fakeEmbed() {
  return vi.fn(
    /** @param {string[]} texts @param {'query'|'passage'} _inputType */
    async (texts, _inputType) =>
      texts.map((t) => (/calendar|kalender/i.test(t) ? axisVector(1) : axisVector(0)))
  );
}

describe('createRouterIndex', () => {
  it('rank() before warm-up throws NotReadyError without embedding anything', async () => {
    const embed = fakeEmbed();
    const index = createRouterIndex({ embed, skills: SKILLS });
    await expect(index.rank('hello', 'en')).rejects.toBeInstanceOf(NotReadyError);
    expect(embed).not.toHaveBeenCalled();
  });

  it('warmUp embeds all phrases in chunks of at most 32, as "passage"', async () => {
    const manyPhrases = Array.from({ length: 70 }, (_, i) => `phrase ${i}`);
    const skills = [{ id: 'x', phrases: { de: manyPhrases, en: [] } }];
    const embed = vi.fn(
      /** @param {string[]} texts @param {'query'|'passage'} _inputType */
      async (texts, _inputType) => texts.map(() => axisVector(0))
    );
    const index = createRouterIndex({ embed, skills });
    await index.warmUp();
    expect(embed).toHaveBeenCalledTimes(3); // 70 / 32 -> 3 chunks
    for (const call of embed.mock.calls) {
      expect(call[0].length).toBeLessThanOrEqual(32);
      expect(call[1]).toBe('passage');
    }
    expect(index.ready()).toBe(true);
  });

  it('rank() calls embed with input_type "query"', async () => {
    const embed = fakeEmbed();
    const index = createRouterIndex({ embed, skills: SKILLS });
    await index.warmUp();
    embed.mockClear();
    await index.rank('Zeig den Kalender', 'de');
    expect(embed).toHaveBeenCalledWith(['Zeig den Kalender'], 'query');
  });

  it('a rejected query embed leaves ready() === true and vectors intact', async () => {
    const embed = fakeEmbed();
    const index = createRouterIndex({ embed, skills: SKILLS });
    await index.warmUp();
    expect(index.ready()).toBe(true);

    embed.mockRejectedValueOnce(new Error('query embed failed'));
    await expect(index.rank('Zeig den Kalender', 'de')).rejects.toThrow('query embed failed');
    expect(index.ready()).toBe(true);

    // still usable afterwards
    const matches = await index.rank('Zeig den Kalender', 'de');
    expect(matches[0].skill).toBe('calendar');
  });

  it('warmUp fails (so it can be retried) when the embed response length does not match the batch', async () => {
    // SKILLS flattens to 5 phrases total; returning only 1 vector simulates
    // a truncated/malformed embed-service response.
    const embed = vi.fn().mockResolvedValue([axisVector(0)]);
    const index = createRouterIndex({ embed, skills: SKILLS });
    await expect(index.warmUp()).rejects.toThrow(/malformed/);
    expect(index.ready()).toBe(false);
  });

  it('scores pick the max dot product per skill, top 5, locale-filtered', async () => {
    const embed = fakeEmbed();
    const index = createRouterIndex({ embed, skills: SKILLS });
    await index.warmUp();
    const matches = await index.rank('Zeig den Kalender', 'de');
    expect(matches.length).toBeLessThanOrEqual(5);
    expect(matches[0]).toEqual({ skill: 'calendar', score: 1 });
    // "home" phrases (axis 0) are orthogonal to the query's axis-1 vector
    const home = matches.find((m) => m.skill === 'home');
    expect(home?.score).toBe(0);
  });
});

describe('embedTexts', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs {texts, input_type} with a bare Authorization header and returns embeddings', async () => {
    /** @type {any} */
    let capturedInit;
    globalThis.fetch = vi.fn(async (url, init) => {
      capturedInit = init;
      return new Response(JSON.stringify({ embeddings: [[1, 2, 3]] }), { status: 200 });
    });

    const result = await embedTexts(['hello'], 'query', {
      url: 'https://embed.example',
      apiKey: 'SECRET-KEY'
    });

    expect(result).toEqual([[1, 2, 3]]);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://embed.example/embed', expect.anything());
    expect(capturedInit.headers.Authorization).toBe('SECRET-KEY');
    expect(JSON.parse(capturedInit.body)).toEqual({ texts: ['hello'], input_type: 'query' });
  });

  it('throws when the embed service responds with a non-OK status', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(
      embedTexts(['x'], 'passage', { url: 'https://embed.example', apiKey: 'k' })
    ).rejects.toThrow();
  });
});
