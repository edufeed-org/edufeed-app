/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { postJson } from './apiRoute.fixtures.js';
import { answerQuestion, TOOL_DEADLINE_MS } from '$lib/server/termi/answer.js';
import { parseSearchRelays } from '$lib/server/termi/knowledge-tools.js';

const ENV = { TERMI_AI_ENABLED: 'true', NOPE_MCP_URL: 'https://mcp.example/mcp' };

/** @param {Partial<import('$lib/termi/items.d.js').Item>} p @returns {any} */
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
    getContent: vi.fn(async () => none),
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

  // nope-mcp reads "Klasse 7" itself and prefers material of that level; an
  // earlier audience parameter cut it from the query, and the level was lost.
  it('keeps the grade a question names in the search text', async () => {
    const tools = fakeTools();
    await answerQuestion('Finde Material zu Fotosynthese, Klasse 7', 'de', tools);
    expect(tools.searchContent).toHaveBeenCalledWith(
      expect.stringMatching(/Fotosynthese.*Klasse 7/)
    );
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

  it('a tool that never answers lands in sourcesUnavailable after the deadline', async () => {
    vi.useFakeTimers();
    try {
      const tools = fakeTools({
        searchContent: vi.fn(async () => ({
          items: [item({ type: 'resource', title: 'r' })],
          sourcesUnavailable: []
        })),
        findCommunity: vi.fn(() => new Promise(() => {}))
      });
      const pending = answerQuestion('Photosynthese', 'de', tools);
      await vi.advanceTimersByTimeAsync(TOOL_DEADLINE_MS);
      const { items, sourcesUnavailable } = await pending;
      expect(sourcesUnavailable).toEqual(['find_community']);
      expect(items.map((i) => i.title)).toEqual(['r']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('one person item when findPeople and aggregatePeople return the same person', async () => {
    const lohrer = item({ type: 'person', id: 'pk-lohrer', title: 'Jörg Lohrer' });
    const tools = fakeTools({
      findPeople: vi.fn(async () => ({ items: [lohrer], sourcesUnavailable: [] })),
      aggregatePeople: vi.fn(async () => ({ items: [lohrer], sourcesUnavailable: [] }))
    });
    const { items } = await answerQuestion('Wer ist Jörg Lohrer?', 'de', tools);
    expect(tools.findPeople).toHaveBeenCalledWith('Jörg Lohrer');
    expect(items.filter((i) => i.type === 'person')).toHaveLength(1);
  });

  it('a quoted topic is no person; a capitalised pair after "mit" is no name', async () => {
    const tools = fakeTools();
    await answerQuestion('Material zu „Klimawandel“', 'de', tools);
    expect(tools.findPeople).not.toHaveBeenCalled();
    expect(tools.aggregatePeople).not.toHaveBeenCalled();

    await answerQuestion('Wer beschäftigt sich mit Künstlicher Intelligenz', 'de', tools);
    expect(tools.findPeople).not.toHaveBeenCalled();
    expect(tools.aggregatePeople).toHaveBeenCalledWith('Künstlicher Intelligenz');
  });

  it('a passage below 0.5 stays in the content tier', async () => {
    const tools = fakeTools({
      searchContent: vi.fn(async () => ({
        items: [item({ type: 'resource', title: 'r', score: 0.4 })],
        sourcesUnavailable: []
      })),
      searchPassages: vi.fn(async () => ({
        items: [item({ type: 'passage', title: 'p', score: 0.3 })],
        sourcesUnavailable: []
      }))
    });
    const { items } = await answerQuestion('was kann ich tun?', 'de', tools);
    expect(items.map((i) => i.title)).toEqual(['r', 'p']);
  });

  it('diversity pulls a lower-scored type into the top 4', async () => {
    const tools = fakeTools({
      searchContent: vi.fn(async () => ({
        items: [1, 2, 3, 4, 5].map((i) => item({ type: 'resource', title: `r${i}`, score: 0.9 })),
        sourcesUnavailable: []
      })),
      searchEvents: vi.fn(async () => ({
        items: [item({ type: 'event', title: 'e', score: 0.1 })],
        sourcesUnavailable: []
      }))
    });
    const { items } = await answerQuestion('Workshop Medien', 'de', tools);
    expect(items.slice(0, 4).map((i) => i.title)).toContain('e');
    expect(items.map((i) => i.title)).toEqual(['r1', 'e', 'r2', 'r3', 'r4', 'r5']);
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

  it('with authors: only their content, no query, no other tools, weak items kept', async () => {
    const pk = 'd'.repeat(64);
    const tools = fakeTools({
      searchContent: vi.fn(async () => ({
        items: [item({ type: 'resource', title: 'von Ada', weak: true })],
        sourcesUnavailable: []
      }))
    });
    const out = await answerQuestion('Ada Lovelace', 'de', tools, { authors: [pk] });
    expect(tools.searchContent).toHaveBeenCalledWith('', { authors: [pk] });
    expect(tools.findCommunity).not.toHaveBeenCalled();
    expect(out.items.map((i) => i.title)).toEqual(['von Ada']);
  });

  it('with authors: a failing search names search_content', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const tools = fakeTools({
      searchContent: vi.fn(async () => {
        throw new Error('down');
      })
    });
    const out = await answerQuestion('Ada', 'de', tools, { authors: ['d'.repeat(64)] });
    expect(out).toEqual({ items: [], sourcesUnavailable: ['search_content'] });
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

  it('returns 429 once 100 requests per minute arrive across all IPs', async () => {
    const { POST } = await importRoute(ENV);
    const body = { text: 'hallo', locale: 'de' };
    for (let i = 0; i < 100; i++) {
      const res = await POST(ev(postJson('/api/termi/search', body), `10.0.${i % 20}.1`));
      expect(res.status).toBe(200);
    }
    const res = await POST(ev(postJson('/api/termi/search', body), '9.9.9.9'));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate' });
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

  it.each([
    ['not an array', 'abc'],
    ['a number', 5],
    ['a non-hex string', ['x']],
    ['an npub', ['npub1abc']],
    ['six keys', Array.from({ length: 6 }, (_, i) => String(i).repeat(64))]
  ])('returns 400 for authors: %s', async (_label, authors) => {
    const { POST } = await importRoute(ENV);
    const res = await POST(
      ev(postJson('/api/termi/search', { text: 'Ada', locale: 'de', authors }))
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_authors' });
  });

  it('passes valid authors to search_content', async () => {
    const tools = fakeTools();
    const { POST } = await importRoute(ENV, tools);
    const pk = 'e'.repeat(64);
    const res = await POST(
      ev(postJson('/api/termi/search', { text: 'Ada', locale: 'de', authors: [pk] }))
    );
    expect(res.status).toBe(200);
    expect(tools.searchContent).toHaveBeenCalledWith('', { authors: [pk] });
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
