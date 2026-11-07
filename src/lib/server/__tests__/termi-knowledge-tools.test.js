/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { createKnowledgeTools, DEFAULT_SEARCH_RELAYS } from '../termi/knowledge-tools.js';
import { buildTermiTools } from '../termi/tools.js';
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

  it('findPeople resolves authors', async () => {
    const { callTool, tools } = setup();
    const out = await tools.findPeople('Laura Mößle');
    expect(callTool).toHaveBeenCalledWith('resolve_author', { name: 'Laura Mößle', limit: 5 });
    expect(out.items.map((i) => i.href)).toEqual(
      resolveAuthor.candidates.map((c) => `/p/${c.npub}`)
    );
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

  it('exposes exactly the six knowledge tools', () => {
    expect(Object.keys(ask(vi.fn())).sort()).toEqual(
      [
        'find_community',
        'find_people',
        'search_content',
        'search_events',
        'search_passages',
        'search_resources'
      ].sort()
    );
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
