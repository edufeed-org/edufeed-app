/** @vitest-environment node */
// LANDING_SHOWCASE_LISTS → runtimeConfig.landing.showcaseLists: the kind 30000
// lists (naddrs) whose members — accounts and communities — may appear on the
// logged-out landing. Unset means the landing shows no live content.
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** @param {Record<string, string>} env */
async function configWith(env) {
  vi.doMock('$env/dynamic/private', () => ({ env }));
  const { GET } = await import('../../routes/api/config/+server.js');
  return GET().json();
}

describe('GET /api/config — landing', () => {
  beforeEach(() => vi.resetModules());

  it('no lists by default', async () => {
    const body = await configWith({});
    expect(body.landing).toEqual({
      showcaseLists: [],
      showcaseListsByType: { learning: [], events: [], articles: [] }
    });
  });

  it('parses a comma-separated naddr list, trimmed, blanks dropped', async () => {
    const body = await configWith({ LANDING_SHOWCASE_LISTS: ' naddr1aaa , ,naddr1bbb ' });
    expect(body.landing.showcaseLists).toEqual(['naddr1aaa', 'naddr1bbb']);
  });

  it('per-type lists override the global list for that panel only', async () => {
    const body = await configWith({
      LANDING_SHOWCASE_LISTS: 'naddr1all',
      LANDING_SHOWCASE_LISTS_LEARNING: 'naddr1mat, naddr1mat2',
      LANDING_SHOWCASE_LISTS_ARTICLES: 'naddr1art'
    });
    expect(body.landing).toEqual({
      showcaseLists: ['naddr1all'],
      showcaseListsByType: {
        learning: ['naddr1mat', 'naddr1mat2'],
        events: [],
        articles: ['naddr1art']
      }
    });
  });
});
