/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { postJson } from './apiRoute.fixtures.js';
import { answerQuestion, parseSearchRelays } from '$lib/server/termi/answer.js';

const ENV = { TERMI_AI_ENABLED: 'true', NOPE_MCP_URL: 'https://mcp.example/mcp' };

/** @param {Partial<import('$lib/server/termi/items.js').Item>} p @returns {any} */
const item = (p) => ({ id: p.title, title: 'x', href: '/x', ...p });
/** @type {{ items: any[], sourcesUnavailable: string[] }} */
const none = { items: [], sourcesUnavailable: [] };

/** Fake knowledge tools; every one answers nothing unless overridden. @param {Record<string, any>} [over] */
function fakeTools(over = {}) {
  return {
    searchContent: vi.fn(async () => none),
    searchResources: vi.fn(async () => none),
    searchEvents: vi.fn(async () => none),
    searchPassages: vi.fn(async () => none),
    findCommunity: vi.fn(async () => none),
    findPeople: vi.fn(async () => none),
    aggregatePeople: vi.fn(async () => none),
    ...over
  };
}

describe('answerQuestion', () => {
  it('puts the community matched by name first, then the rest by score, ≤ 8 items', async () => {
    const content = Array.from({ length: 12 }, (_, i) =>
      item({ type: 'resource', title: `r${i}`, score: i / 20 })
    );
    const tools = fakeTools({
      searchContent: vi.fn(async () => ({ items: content, sourcesUnavailable: [] })),
      findCommunity: vi.fn(async () => ({
        items: [item({ type: 'community', title: 'e-teaching.org' })],
        sourcesUnavailable: []
      }))
    });
    const { items } = await answerQuestion('ich suche die e-teaching community', 'de', tools);
    expect(items).toHaveLength(8);
    expect(items[0]).toMatchObject({ type: 'community', title: 'e-teaching.org' });
    expect(items[1].title).toBe('r11');
    expect(items[2].title).toBe('r10');
    expect(tools.findCommunity).toHaveBeenCalledWith('e-teaching');
    expect(tools.findPeople).not.toHaveBeenCalled();
    expect(tools.searchEvents).not.toHaveBeenCalled();
  });

  it('runs searchEvents on an event cue and keeps an event in the top 4', async () => {
    const tools = fakeTools({
      searchContent: vi.fn(async () => ({
        items: Array.from({ length: 6 }, (_, i) =>
          item({ type: 'resource', title: `r${i}`, score: 0.5 })
        ),
        sourcesUnavailable: []
      })),
      searchEvents: vi.fn(async () => ({
        items: [item({ type: 'event', title: 'Fortbildung Medien' })],
        sourcesUnavailable: []
      }))
    });
    const { items } = await answerQuestion(
      'ich suche Fortbildungen zum Thema Medienkompetenz',
      'de',
      tools
    );
    expect(tools.searchEvents).toHaveBeenCalledWith('Medienkompetenz');
    expect(
      items
        .slice(0, 4)
        .map((i) => i.type)
        .includes('event')
    ).toBe(true);
  });

  it('aggregates people for "wer …", resolve_author by name only for a named person', async () => {
    const tools = fakeTools({
      searchContent: vi.fn(async () => ({
        items: [1, 2, 3].map((i) => item({ type: 'resource', title: `r${i}`, score: 0.7 })),
        sourcesUnavailable: []
      })),
      aggregatePeople: vi.fn(async () => ({
        items: [item({ type: 'person', title: 'Laura Mößle', href: undefined })],
        sourcesUnavailable: []
      }))
    });
    const { items } = await answerQuestion(
      'wer beschäftigt sich mit dem Thema OER-Lizenzen?',
      'de',
      tools
    );
    expect(tools.aggregatePeople).toHaveBeenCalledWith('OER Lizenzen');
    expect(tools.findPeople).not.toHaveBeenCalled();
    // the relay's NIP-50 search misses hyphenated compounds
    expect(tools.searchContent).toHaveBeenCalledWith('OER Lizenzen');
    expect(items.slice(0, 3).map((i) => i.type)).toContain('person');

    await answerQuestion('wer ist Jörg Lohrer?', 'de', tools);
    expect(tools.findPeople).toHaveBeenCalledWith('Jörg Lohrer');
    await answerQuestion('Wo finde ich Leute namens Jörg?', 'de', tools);
    expect(tools.findPeople).toHaveBeenLastCalledWith('Jörg');
  });

  it('runs searchPassages (limit 3) on a question cue and puts passages before content', async () => {
    const tools = fakeTools({
      searchContent: vi.fn(async () => ({
        items: [1, 2, 3].map((i) => item({ type: 'resource', title: `r${i}`, score: 0.9 })),
        sourcesUnavailable: []
      })),
      searchPassages: vi.fn(async () => ({
        items: [item({ type: 'passage', title: 'p1', score: 0.7 })],
        sourcesUnavailable: []
      }))
    });
    const text = 'meine Schüler sind unaufmerksam, was kann ich verbessern?';
    const { items } = await answerQuestion(text, 'de', tools);
    expect(tools.searchPassages).toHaveBeenCalledWith(text, { limit: 3 });
    expect(items[0]).toMatchObject({ type: 'passage', title: 'p1' });

    // a loose passage ranks with the content
    tools.searchPassages.mockResolvedValueOnce({
      items: [item({ type: 'passage', title: 'loose', score: 0.3 })],
      sourcesUnavailable: []
    });
    const loose = await answerQuestion(text, 'de', tools);
    expect(loose.items[0].title).toBe('r1');

    tools.searchPassages.mockClear();
    await answerQuestion(
      'ich suche nach Unterrichtsentwürfen zum Thema Nachhaltigkeit',
      'de',
      tools
    );
    expect(tools.searchPassages).not.toHaveBeenCalled();
  });

  it('drops weak items', async () => {
    const tools = fakeTools({
      searchContent: vi.fn(async () => ({
        items: [item({ type: 'resource', title: 'tail', weak: true }), item({ type: 'resource' })],
        sourcesUnavailable: []
      }))
    });
    const { items } = await answerQuestion('Photosynthese', 'de', tools);
    expect(items.map((i) => i.title)).toEqual(['x']);
  });

  it('passes sourcesUnavailable through and names a rejected tool', async () => {
    const tools = fakeTools({
      searchContent: vi.fn(async () => ({ items: [], sourcesUnavailable: ['wss://oersi/'] })),
      searchEvents: vi.fn(async () => {
        throw new Error('down');
      })
    });
    const { sourcesUnavailable } = await answerQuestion('Workshop Medien', 'de', tools);
    expect(sourcesUnavailable).toEqual(['wss://oersi/', 'search_events']);
  });
});

describe('parseSearchRelays', () => {
  it.each([
    [undefined, ['amb-relay', 'oersi', 'sodix']],
    ['', ['amb-relay', 'oersi', 'sodix']],
    [' amb-relay , sodix ', ['amb-relay', 'sodix']]
  ])('%j', (value, expected) => {
    expect(parseSearchRelays(value)).toEqual(expected);
  });
});

/** @param {Request} request @param {string} [ip] @returns {any} */
function ev(request, ip = '1.2.3.4') {
  return { request, getClientAddress: () => ip };
}

/** @param {Record<string, string>} env @param {ReturnType<typeof fakeTools>} [tools] */
async function importRoute(env, tools = fakeTools()) {
  vi.resetModules();
  vi.doMock('$env/dynamic/private', () => ({ env }));
  const createKnowledgeTools = vi.fn(() => tools);
  vi.doMock('$lib/server/termi/knowledge-tools.js', async (orig) => ({
    ...(await orig()),
    createKnowledgeTools
  }));
  const mod = await import('../../routes/api/termi/search/+server.js');
  return { POST: mod.POST, createKnowledgeTools };
}

afterEach(() => {
  vi.doUnmock('$env/dynamic/private');
  vi.doUnmock('$lib/server/termi/knowledge-tools.js');
});

describe('POST /api/termi/search', () => {
  it.each([
    ['flag off', { NOPE_MCP_URL: 'https://mcp.example/mcp' }],
    ['no nope-mcp URL', { TERMI_AI_ENABLED: 'true' }]
  ])('returns 503 when %s', async (_label, env) => {
    const { POST } = await importRoute(env);
    const res = await POST(ev(postJson('/api/termi/search', { text: 'hallo', locale: 'de' })));
    expect(res.status).toBe(503);
  });

  it.each([
    ['empty text', { text: '  ', locale: 'de' }],
    ['301-char text', { text: 'a'.repeat(301), locale: 'de' }],
    ['non-string text', { text: 42, locale: 'de' }],
    ['invalid locale', { text: 'hallo', locale: 'fr' }]
  ])('returns 400 for %s', async (_label, body) => {
    const { POST } = await importRoute(ENV);
    const res = await POST(ev(postJson('/api/termi/search', body)));
    expect(res.status).toBe(400);
  });

  it('returns 429 after 30 requests per minute from one IP', async () => {
    const { POST } = await importRoute(ENV);
    const body = { text: 'hallo', locale: 'de' };
    for (let i = 0; i < 30; i++) {
      expect((await POST(ev(postJson('/api/termi/search', body)))).status).toBe(200);
    }
    expect((await POST(ev(postJson('/api/termi/search', body)))).status).toBe(429);
    expect((await POST(ev(postJson('/api/termi/search', body), '5.6.7.8'))).status).toBe(200);
  });

  it('answers with items and sourcesUnavailable, using TERMI_SEARCH_RELAYS', async () => {
    const tools = fakeTools({
      findCommunity: vi.fn(async () => ({
        items: [item({ type: 'community', title: 'e-teaching.org' })],
        sourcesUnavailable: []
      })),
      searchContent: vi.fn(async () => ({
        items: [item({ type: 'resource', title: 'r', score: 0.4 })],
        sourcesUnavailable: ['sodix']
      }))
    });
    const { POST, createKnowledgeTools } = await importRoute(
      { ...ENV, TERMI_SEARCH_RELAYS: 'amb-relay,oersi' },
      tools
    );
    const res = await POST(
      ev(
        postJson('/api/termi/search', { text: 'ich suche die e-teaching community', locale: 'de' })
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((/** @type {any} */ i) => i.type)).toEqual(['community', 'resource']);
    expect(body.sourcesUnavailable).toEqual(['sodix']);
    expect(createKnowledgeTools).toHaveBeenCalledWith(
      expect.objectContaining({ relays: ['amb-relay', 'oersi'] })
    );
  });

  it('never logs the user text', async () => {
    const spies = ['log', 'info', 'warn', 'error'].map((m) =>
      vi.spyOn(console, /** @type {any} */ (m)).mockImplementation(() => {})
    );
    const tools = fakeTools({
      searchContent: vi.fn(async () => {
        throw new Error('boom');
      })
    });
    const { POST } = await importRoute(ENV, tools);
    const secret = 'geheimer Satz 4711';
    await POST(ev(postJson('/api/termi/search', { text: secret, locale: 'de' })));
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain('4711');
      spy.mockRestore();
    }
  });
});
