/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { createKnowledgeTools, DEFAULT_SEARCH_RELAYS } from '../termi/knowledge-tools.js';
import { buildTermiTools } from '../termi/tools.js';
import { nip19 } from 'nostr-tools';
import searchContent from './fixtures/nope-mcp/search_content.json';
import searchResources from './fixtures/nope-mcp/search_resources.json';
import calendar from './fixtures/nope-mcp/search_calendar_events.json';
import passages from './fixtures/nope-mcp/search_passages.json';
import resolveAuthor from './fixtures/nope-mcp/resolve_author.json';
import findCommunity from './fixtures/nope-mcp/find_community.2a.json';
import findCommunityError from './fixtures/nope-mcp/find_community.error.json';

const NOW_MS = 1_794_000_000_000;

/** @type {Record<string, any>} */
const FIXTURES = {
  search_content: searchContent,
  search_resources: searchResources,
  search_calendar_events: calendar,
  search_passages: passages,
  resolve_author: resolveAuthor,
  find_community: findCommunity
};

function unknownTool() {
  return Object.assign(new Error(findCommunityError.message), { isToolError: true });
}

/** @param {(name: string, args: any) => Promise<any>} [impl] */
function setup(impl) {
  const callTool = vi.fn(impl ?? (async (/** @type {string} */ name) => FIXTURES[name]));
  const tools = createKnowledgeTools({
    callTool,
    relays: DEFAULT_SEARCH_RELAYS,
    now: () => NOW_MS
  });
  return { callTool, tools };
}

describe('createKnowledgeTools', () => {
  it('defaults to the three short relay names list_relays accepts', () => {
    expect(DEFAULT_SEARCH_RELAYS).toEqual(['amb-relay', 'oersi', 'sodix']);
  });

  it('searchContent passes the relays and types, returns resource items', async () => {
    const { callTool, tools } = setup();
    const out = await tools.searchContent('Statistik Vorkurs', { types: ['resource', 'bogus'] });
    expect(callTool).toHaveBeenCalledWith('search_content', {
      query: 'Statistik Vorkurs',
      relays: ['amb-relay', 'oersi', 'sodix'],
      limit: 20,
      types: ['resource']
    });
    expect(out.items).toHaveLength(3);
    expect(out.items.every((i) => i.type === 'resource')).toBe(true);
    expect(out.sourcesUnavailable).toEqual([]);
  });

  it('searchContent passes up to 5 valid hex authors; an empty query is omitted', async () => {
    const { callTool, tools } = setup();
    const keys = Array.from({ length: 7 }, (_, i) => String(i).repeat(64));
    await tools.searchContent('', { authors: [...keys, 'npub1x', 'A'.repeat(64)] });
    expect(callTool).toHaveBeenCalledWith('search_content', {
      relays: ['amb-relay', 'oersi', 'sodix'],
      limit: 20,
      authors: keys.slice(0, 5)
    });
    await tools.searchContent('x', { authors: ['bogus'] });
    expect(callTool.mock.calls[1][1]).not.toHaveProperty('authors');
  });

  it('searchContent with a community merges overlapping legs: deduped, shared first, capped at 20', async () => {
    const hex = 'c'.repeat(64);
    const hitOf = (/** @type {number} */ i) => ({
      type: 'resource',
      title: `t${i}`,
      naddr: nip19.naddrEncode({ kind: 30142, pubkey: 'a'.repeat(64), identifier: `d${i}` })
    });
    const range = (/** @type {number} */ from, /** @type {number} */ to) =>
      Array.from({ length: to - from }, (_, k) => hitOf(from + k));
    const { callTool, tools } = setup(async (_n, args) =>
      args.community ? { results: range(0, 12) } : { results: range(6, 24) }
    );
    const out = await tools.searchContent('Frieden', { community: hex, authors: ['d'.repeat(64)] });
    const calls = callTool.mock.calls.map((c) => c[1]);
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.community)).toMatchObject({ community: hex });
    expect(calls.find((c) => c.authors)).toMatchObject({ authors: [hex] });
    expect(calls.find((c) => c.community)).not.toHaveProperty('authors');
    // 12 + 18 hits, 6 shared: 24 distinct, cut to 20; the community leg's 12 come first
    expect(out.items.map((i) => i.title)).toEqual(range(0, 20).map((h) => h.title));
  });

  it('one community leg failing keeps the other leg; both failing throws', async () => {
    const hex = 'c'.repeat(64);
    const { tools } = setup(async (_n, args) => {
      if (args.authors) throw new Error('boom');
      return { results: searchContent.results.slice(0, 1) };
    });
    expect((await tools.searchContent('x', { community: hex })).items).toHaveLength(1);
    const dead = setup(async () => {
      throw new Error('down');
    }).tools;
    await expect(dead.searchContent('x', { community: hex })).rejects.toThrow('down');
  });

  it('an invalid community (npub, garbage, uppercase) is dropped: one plain search', async () => {
    const { callTool, tools } = setup();
    for (const c of [nip19.npubEncode('c'.repeat(64)), 'nsec1garbage', 'A'.repeat(64)])
      await tools.searchContent('Frieden', { community: c });
    expect(callTool).toHaveBeenCalledTimes(3);
    for (const c of callTool.mock.calls) {
      expect(c[1]).not.toHaveProperty('community');
      expect(c[1]).not.toHaveProperty('authors');
    }
  });

  it('a filtered search with 0 hits (also merged community legs) carries a note naming the filter', async () => {
    const empty = { results: [], relaysSearched: [] };
    const hex = 'c'.repeat(64);
    const { tools } = setup(async () => empty);
    const filtered = await tools.searchContent('Friedenspädagogik', { community: hex });
    expect(filtered.note).toMatch(/community/);
    expect(filtered.note).toMatch(/gleichen Filter/);
    expect(filtered.note).toContain('einmal');
    expect((await tools.searchContent('x', { types: ['wiki'] })).note).toMatch(/types/);
    // unfiltered and empty: its own note (less fitting hits), see below
    expect((await tools.searchContent('x')).note).not.toMatch(/Filter/);
    const full = setup().tools;
    expect((await full.searchContent('x', { community: hex })).note).toBeUndefined();
  });

  // nope-mcp returns only the learning resources that fit a question, so an
  // answer can be empty. `lessFitting: true` returns what it held back; the
  // person decides whether to see that.
  it('searchContent with lessFitting asks nope-mcp for the hits it held back', async () => {
    const { callTool, tools } = setup();
    await tools.searchContent('Fotosynthese Klasse 7', { lessFitting: true });
    expect(callTool).toHaveBeenCalledWith('search_content', {
      query: 'Fotosynthese Klasse 7',
      relays: ['amb-relay', 'oersi', 'sodix'],
      limit: 20,
      lessFitting: true
    });
  });

  it('an unfiltered search with 0 hits tells the model it may offer less fitting hits, once', async () => {
    const { tools } = setup(async () => ({ results: [], relaysSearched: [] }));
    const empty = await tools.searchContent('Quantenkryptographie Grundschule');
    expect(empty.note).toMatch(/lessFitting: true/);
    expect(empty.note).toMatch(/erst, wenn/); // not on its own: the person decides
    expect((await tools.searchContent('x', { lessFitting: true })).note).toBeUndefined();
    expect((await tools.searchContent('')).note).toBeUndefined(); // no topic, nothing to judge
  });

  it('getContent maps the real get_resource shape like the search hit of that resource', async () => {
    const hit = searchContent.results[0];
    const wrapped = {
      resource: {
        type: ['LearningResource'],
        name: hit.title,
        description: hit.description,
        url: hit.url,
        sourcePage: 'https://example.org/orig.pdf',
        creator: [{ name: 'Dr. Julia Gerth', type: 'Person' }],
        license: { id: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' },
        nostr: { pubkey: 'c'.repeat(64), naddr: hit.naddr }
      },
      accessLevel: 'full'
    };
    const { tools } = setup(async () => wrapped);
    const [item] = (await tools.getContent(hit.naddr)).items;
    const [fromSearch] = (await setup(async () => ({ results: [hit] })).tools.searchContent('x'))
      .items;
    expect(item).toMatchObject({
      type: 'resource',
      title: hit.title,
      href: fromSearch.href,
      creator: 'Dr. Julia Gerth',
      license: 'CC BY 4.0',
      sourceUrl: 'https://example.org/orig.pdf'
    });
  });

  it('getContent asks get_resource for the naddr and maps the hit like a search result', async () => {
    const hit = searchContent.results[0];
    const { callTool, tools } = setup(async () => hit);
    const out = await tools.getContent(hit.naddr);
    expect(callTool).toHaveBeenCalledWith('get_resource', { naddr: hit.naddr });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].type).toBe('resource');
    expect(out.items[0].title).toBe(hit.title);
  });

  it('searchResources whitelists filters', async () => {
    const { callTool, tools } = setup();
    const out = await tools.searchResources('Nachhaltigkeit', {
      educationalLevelLabel: 'Grundschule',
      licenseFilter: 'open',
      evil: 'x'
    });
    expect(callTool.mock.calls[0][1]).toEqual({
      query: 'Nachhaltigkeit',
      relays: ['amb-relay', 'oersi', 'sodix'],
      limit: 10,
      educationalLevelLabel: 'Grundschule',
      licenseFilter: 'open'
    });
    expect(out.items).toHaveLength(3);
  });

  it('searchEvents asks only for events not yet over, passes relaysIncomplete through', async () => {
    const { callTool, tools } = setup(async () => ({
      ...calendar,
      relaysIncomplete: ['wss://calendar.example']
    }));
    const out = await tools.searchEvents('Fortbildung', {
      level: 'https://w3id.org/kim/educationalLevel/level_C'
    });
    expect(callTool).toHaveBeenCalledWith('search_calendar_events', {
      query: 'Fortbildung',
      endAfter: NOW_MS / 1000,
      limit: 10,
      educationalLevel: 'https://w3id.org/kim/educationalLevel/level_C'
    });
    expect(out.items.map((i) => i.type)).toEqual(['event', 'event', 'event']);
    expect(out.sourcesUnavailable).toEqual(['wss://calendar.example']);
  });

  it('searchEvents with from/to asks for events running during that window in the zone', async () => {
    const { callTool, tools } = setup();
    await tools.searchEvents('relilab', {
      from: '2026-11-16',
      to: '2026-11-22',
      tz: 'Europe/Berlin'
    });
    expect(callTool).toHaveBeenCalledWith('search_calendar_events', {
      query: 'relilab',
      // from 2026-11-16 00:00 CET to the last second of 2026-11-22 CET (startBefore is inclusive)
      endAfter: Date.UTC(2026, 10, 15, 23) / 1000,
      startBefore: Date.UTC(2026, 10, 22, 23) / 1000 - 1,
      limit: 10
    });
  });

  it('searchEvents with only to keeps endAfter now; bad dates are ignored', async () => {
    const { callTool, tools } = setup();
    await tools.searchEvents('x', { from: '16.11.2026', to: '2026-11-22' });
    expect(callTool.mock.calls[0][1]).toEqual({
      query: 'x',
      endAfter: NOW_MS / 1000,
      startBefore: Date.UTC(2026, 10, 23) / 1000 - 1,
      limit: 10
    });
  });

  it('searchPassages queries the five content kinds', async () => {
    const { callTool, tools } = setup();
    const out = await tools.searchPassages('Aktivierung im Seminar', { relay: 'oersi' });
    expect(callTool).toHaveBeenCalledWith('search_passages', {
      question: 'Aktivierung im Seminar',
      kinds: [30142, 30023, 30818, 30040, 30041],
      relays: ['oersi'],
      limit: 4
    });
    expect(out.items[0].type).toBe('passage');
  });

  it('searchPassages without a relay sends all configured relays', async () => {
    const { callTool, tools } = setup();
    await tools.searchPassages('Aktivierung');
    expect(callTool.mock.calls[0][1].relays).toEqual(['amb-relay', 'oersi', 'sodix']);
  });

  it('maps known short relay names to hint URLs when relaysSearched is missing', async () => {
    const { relaysSearched, ...noEcho } = searchContent;
    const tools = createKnowledgeTools({
      callTool: async () => noEcho,
      relays: ['oersi', 'unknown', 'wss://x.example/']
    });
    const { items } = await tools.searchContent('x');
    const data = /** @type {any} */ (nip19.decode(String(items[1].href).slice(1))).data;
    expect(data.relays).toEqual(['wss://oersi.edufeed.org', 'wss://x.example/']);
    expect(relaysSearched).toHaveLength(3);
  });

  it('findPeople resolves authors', async () => {
    const { callTool, tools } = setup();
    const out = await tools.findPeople('Laura Mößle');
    expect(callTool).toHaveBeenCalledWith('resolve_author', { name: 'Laura Mößle', limit: 5 });
    expect(out.items.map((i) => i.href)).toEqual(
      resolveAuthor.candidates.map((c) => `/p/${c.npub}`)
    );
  });

  it('searchPassages takes a limit', async () => {
    const { callTool, tools } = setup();
    await tools.searchPassages('Aktivierung', { limit: 3 });
    expect(callTool.mock.calls[0][1].limit).toBe(3);
  });

  it('aggregatePeople ranks Person creators of first-relay hits and resolves exact names', async () => {
    const lohrer = resolveAuthor.candidates[1];
    const hits = [
      {
        score: 0.3,
        creator: [
          { name: 'Laura Mößle', type: 'Person' },
          { name: 'Viera Pirker', type: 'Person' }
        ]
      },
      {
        score: 0.1,
        creator: [{ name: 'Laura Mößle', type: 'Person' }],
        publisher: [{ name: 'LEHRE LADEN', type: 'Organization' }]
      },
      { score: 0.05, creator: [{ name: 'Jörg Lohrer', type: 'Person' }] },
      // a "name" over 100 chars is skipped, even when frequent
      ...[1, 2, 3].map(() => ({
        score: 0.9,
        creator: [{ name: 'x'.repeat(101), type: 'Person' }]
      })),
      ...['A', 'B', 'C', 'D'].map((n) => ({
        score: 0.01,
        creator: [{ name: `P ${n}`, type: 'Person' }]
      }))
    ];
    const { callTool, tools } = setup(async (name, args) => {
      if (name === 'search_content') return { results: hits, relaysIncomplete: [] };
      if (args.name === 'Jörg Lohrer') return { candidates: [{ ...lohrer, name: 'jörg lohrer' }] };
      if (args.name === 'Viera Pirker') throw new Error('down');
      return { candidates: [{ ...lohrer, name: 'Someone Else' }] };
    });
    const out = await tools.aggregatePeople('OER Lizenzen');
    expect(callTool).toHaveBeenCalledWith('search_content', {
      query: 'OER Lizenzen',
      relays: ['amb-relay'],
      limit: 20
    });
    expect(callTool.mock.calls.filter(([n]) => n === 'resolve_author')).toHaveLength(5);
    expect(out.items.map((i) => i.title)).toEqual([
      'Laura Mößle',
      'Viera Pirker',
      'jörg lohrer',
      'P A',
      'P B'
    ]);
    expect(out.items[0]).toEqual({ type: 'person', id: 'name:Laura Mößle', title: 'Laura Mößle' });
    expect(out.items[2].href).toBe(`/p/${lohrer.npub}`);
  });

  it('findCommunity maps communities (2a)', async () => {
    const { tools } = setup();
    const out = await tools.findCommunity('e-teaching');
    expect(out.items[0]).toMatchObject({ type: 'community', title: 'e-teaching.org' });
  });

  it('findCommunity and findPeople return [] when nope-mcp lacks the tool', async () => {
    const { tools } = setup(async () => {
      throw unknownTool();
    });
    expect(await tools.findCommunity('e-teaching')).toEqual({ items: [], sourcesUnavailable: [] });
    expect(await tools.findPeople('x')).toEqual({ items: [], sourcesUnavailable: [] });
  });

  it('other failures propagate', async () => {
    const { tools } = setup(async () => {
      throw Object.assign(new Error('HTTP 500'), { status: 500 });
    });
    await expect(tools.findCommunity('x')).rejects.toThrow('HTTP 500');
  });
});

describe("buildTermiTools('ask')", () => {
  /** @param {any} callTool @param {any} [getToken] */
  const ask = (callTool, getToken = vi.fn(async () => 'tok')) =>
    /** @type {any} */ (
      buildTermiTools('ask', { mcpUrl: 'https://mcp.example/mcp', callTool, getToken })
    );
  /** @param {any} t @param {any} args @returns {Promise<any>} */
  const run = (t, args) => t.execute(args, { toolCallId: 'c', messages: [] });

  it('exposes the six knowledge tools plus get_content and show_pages', () => {
    expect(Object.keys(ask(vi.fn())).sort()).toEqual(
      [
        'find_community',
        'find_people',
        'get_content',
        'search_content',
        'search_events',
        'search_passages',
        'search_resources',
        'show_pages'
      ].sort()
    );
  });

  it('search_content takes lessFitting from the model and passes it on', async () => {
    const callTool = vi.fn(async () => searchContent);
    const tools = ask(callTool);
    expect(tools.search_content.inputSchema.jsonSchema.properties.lessFitting).toMatchObject({
      type: 'boolean'
    });
    await run(tools.search_content, { query: 'Fotosynthese', lessFitting: true });
    expect(/** @type {any} */ (callTool.mock.calls[0])[0].args).toMatchObject({
      query: 'Fotosynthese',
      lessFitting: true
    });
    await run(tools.search_content, { query: 'Fotosynthese', lessFitting: 'yes' });
    expect(/** @type {any} */ (callTool.mock.calls[1])[0].args).not.toHaveProperty('lessFitting');
  });

  it('calls anonymously first and retries with a token only on 401', async () => {
    const unauthorized = Object.assign(new Error('HTTP 401'), { status: 401 });
    const callTool = vi
      .fn()
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValueOnce(searchContent);
    const getToken = vi.fn(async () => 'tok');
    const out = await run(ask(callTool, getToken).search_content, { query: 'Statistik' });
    expect(callTool.mock.calls[0][0]).toMatchObject({
      bearerToken: undefined,
      name: 'search_content'
    });
    expect(callTool.mock.calls[1][0].bearerToken).toBe('tok');
    expect(out.items).toHaveLength(3);
  });

  it('search_content offers an authors filter to the model and passes it on', async () => {
    const callTool = vi.fn(async () => searchContent);
    const tools = ask(callTool);
    const schema = tools.search_content.inputSchema.jsonSchema;
    expect(schema.properties.authors).toMatchObject({
      type: 'array',
      items: { pattern: '^[0-9a-f]{64}$' }
    });
    const pk = 'c'.repeat(64);
    await run(tools.search_content, { query: 'Statistik', authors: [pk, 'bogus'] });
    expect(/** @type {any} */ (callTool.mock.calls[0])[0].args.authors).toEqual([pk]);
  });

  it('search_events offers from/to and maps them in the request time zone', async () => {
    const callTool = vi.fn(async () => calendar);
    const tools = /** @type {any} */ (
      buildTermiTools('ask', {
        mcpUrl: 'https://mcp.example/mcp',
        callTool,
        getToken: vi.fn(),
        tz: 'Europe/Berlin'
      })
    );
    const schema = tools.search_events.inputSchema.jsonSchema;
    expect(schema.properties.from).toMatchObject({ type: 'string' });
    expect(schema.properties.to).toMatchObject({ type: 'string' });
    expect(tools.search_events.description).toContain('from/to');
    await run(tools.search_events, { query: 'relilab', from: '2026-07-01', to: '2026-07-01' });
    const args = /** @type {any} */ (callTool.mock.calls[0])[0].args;
    expect(args.endAfter).toBe(Date.UTC(2026, 5, 30, 22) / 1000); // CEST
    expect(args.startBefore).toBe(Date.UTC(2026, 6, 1, 22) / 1000 - 1);
    expect(args.startAfter).toBeUndefined();
    expect(tools.search_events.description).toContain('in diesem Zeitraum stattfinden');
  });

  it('caps items for the model at 8 and descriptions at 300 chars', async () => {
    const many = {
      ...searchContent,
      results: Array.from({ length: 12 }, (_, i) => ({
        ...searchContent.results[0],
        description: 'x'.repeat(1000),
        naddr: searchContent.results[i % 3].naddr
      }))
    };
    const out = await run(ask(vi.fn(async () => many)).search_content, { query: 'x' });
    expect(out.items).toHaveLength(8);
    expect(out.items.every((/** @type {any} */ i) => i.description.length <= 300)).toBe(true);
  });
});

describe('show_pages tool', () => {
  const ask = (callTool = vi.fn()) =>
    /** @type {any} */ (
      buildTermiTools('ask', { mcpUrl: 'https://mcp.example/mcp', callTool, getToken: vi.fn() })
    );
  const run = (/** @type {any} */ t, /** @type {any} */ args) =>
    t.execute(args, { toolCallId: 'c', messages: [] });

  it('enum lists navigate/create skill ids, never a help skill', () => {
    const { ids } = ask().show_pages.inputSchema.jsonSchema.properties;
    expect(ids.items.enum).toContain('inbox');
    expect(ids.items.enum).toContain('calendar');
    expect(ids.items.enum).not.toContain('help.1');
    expect(ids.maxItems).toBe(2);
  });

  it('echoes the ids unchanged', async () => {
    const out = await run(ask().show_pages, { ids: ['inbox'] });
    expect(out).toEqual({ ids: ['inbox'] });
  });

  it('filters untrusted ids server-side: unknown ids and help skills dropped, capped at 2', async () => {
    const out = await run(ask().show_pages, {
      ids: ['inbox', 'help.1', 'x', 'calendar', 'settings']
    });
    expect(out).toEqual({ ids: ['inbox', 'calendar'] });
  });
});

describe('get_content and the community filter as model tools', () => {
  const ask = (/** @type {any} */ callTool) =>
    /** @type {any} */ (
      buildTermiTools('ask', { mcpUrl: 'https://mcp.example/mcp', callTool, getToken: vi.fn() })
    );
  const run = (/** @type {any} */ t, /** @type {any} */ args) =>
    t.execute(args, { toolCallId: 'c', messages: [] });

  it('search_content has a strictly typed community and hands the note to the model', async () => {
    const callTool = vi.fn(async () => ({ results: [] }));
    const tools = ask(callTool);
    expect(tools.search_content.inputSchema.jsonSchema.properties.community).toMatchObject({
      type: 'string',
      pattern: '^[0-9a-f]{64}$'
    });
    const pk = 'c'.repeat(64);
    const out = await run(tools.search_content, { query: 'Frieden', community: pk });
    expect(/** @type {any} */ (callTool.mock.calls[0])[0].args.community).toBe(pk);
    expect(out.items).toEqual([]);
    expect(out.note).toMatch(/community/);
  });

  it('get_content takes only an naddr; anything else is a tool error saying what is valid', async () => {
    const hit = searchContent.results[0];
    const callTool = vi.fn(async () => hit);
    const tools = ask(callTool);
    expect(tools.get_content.inputSchema.jsonSchema.properties.naddr).toMatchObject({
      type: 'string',
      pattern: '^naddr1[0-9a-z]+$'
    });
    const out = await run(tools.get_content, { naddr: hit.naddr });
    expect(out.items).toHaveLength(1);
    await expect(run(tools.get_content, { naddr: 'https://x.example' })).rejects.toThrow(/naddr1/);
    expect(callTool).toHaveBeenCalledTimes(1);
  });
});

describe('server order', () => {
  it('a late hit with a high score cannot overtake the hits before it', async () => {
    const scores = [1, 0.05, 0.35];
    const results = searchContent.results.slice(0, 3).map((h, i) => ({ ...h, score: scores[i] }));
    expect(results).toHaveLength(3);
    const { tools } = setup(async () => ({ results }));
    const out = await tools.searchContent('Fotosynthese');
    expect(out.items.map((it) => it.score)).toEqual([1, 0.05, 0.05]);
  });
});
