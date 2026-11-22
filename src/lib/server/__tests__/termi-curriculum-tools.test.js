/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { createCurriculumTools, memMcpCaller, memMcpEnv } from '../termi/curriculum-tools.js';
import bundeslaenderText from './fixtures/mem-mcp/list_bundeslaender.json';
import lehrplaeneFixture from './fixtures/mem-mcp/find_lehrplaene.json';
import kompetenzenFixture from './fixtures/mem-mcp/get_kompetenzen.json';

const SCHULARTEN_TEXT = 'uri | label\n---\nhttps://w3id.org/schulart/RP_0000001 | Grundschule';
const SCHULFAECHER_TEXT = 'uri | label\n---\nhttps://w3id.org/schulfach/RP_0000030 | Mathematik';

/** @type {Record<string, string>} */
const FIXTURES = {
  list_bundeslaender: bundeslaenderText,
  list_schularten: SCHULARTEN_TEXT,
  list_schulfaecher: SCHULFAECHER_TEXT,
  find_lehrplaene: lehrplaeneFixture.text,
  get_kompetenzen: kompetenzenFixture.text
};

/** @param {(name: string, args: any) => Promise<string>} [impl] */
function setup(impl) {
  const callTool = vi.fn(impl ?? (async (/** @type {string} */ name) => FIXTURES[name]));
  return { callTool, tools: createCurriculumTools({ callTool }) };
}

describe('memMcpEnv', () => {
  it('defaults to the deployed MEM-MCP URL when unset', () => {
    expect(memMcpEnv({})).toEqual({ mcpUrl: 'https://mcp.mem.edufeed.org/mcp' });
  });

  it('reads MEM_MCP_URL when set', () => {
    expect(memMcpEnv({ MEM_MCP_URL: 'https://mem.example/mcp' })).toEqual({
      mcpUrl: 'https://mem.example/mcp'
    });
  });

  it('MEM_MCP_URL=none turns the MEM tools off', () => {
    expect(memMcpEnv({ MEM_MCP_URL: 'none' })).toEqual({ mcpUrl: undefined });
  });
});

describe('memMcpCaller', () => {
  it('calls anonymously with raw: true, never touching getToken on success', async () => {
    const callTool = vi.fn(async () => 'uri | label\n---\nhttps://example/1 | Erste Zeile');
    const getToken = vi.fn(async () => 'should-not-be-used');
    const caller = memMcpCaller({ mcpUrl: 'https://mem.example/mcp', getToken, callTool });

    const result = await caller('list_bundeslaender', {});

    expect(result).toBe('uri | label\n---\nhttps://example/1 | Erste Zeile');
    expect(getToken).not.toHaveBeenCalled();
    expect(callTool).toHaveBeenCalledWith({
      mcpUrl: 'https://mem.example/mcp',
      bearerToken: undefined,
      name: 'list_bundeslaender',
      args: {},
      raw: true
    });
  });

  it('retries once with a token on a 401, still raw: true', async () => {
    const callTool = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }))
      .mockResolvedValueOnce('uri | label\n---\nhttps://example/1 | Erste Zeile');
    const getToken = vi.fn(async () => 'tok-123');
    const caller = memMcpCaller({ mcpUrl: 'https://mem.example/mcp', getToken, callTool });

    const result = await caller('find_lehrplaene', { bundesland: 'Bayern' });

    expect(result).toBe('uri | label\n---\nhttps://example/1 | Erste Zeile');
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenLastCalledWith({
      mcpUrl: 'https://mem.example/mcp',
      bearerToken: 'tok-123',
      name: 'find_lehrplaene',
      args: { bundesland: 'Bayern' },
      raw: true
    });
  });

  it('propagates a non-401 error without calling getToken', async () => {
    const callTool = vi.fn(async () => {
      throw new Error('timeout');
    });
    const getToken = vi.fn(async () => 'tok-123');
    const caller = memMcpCaller({ mcpUrl: 'https://mem.example/mcp', getToken, callTool });

    await expect(caller('list_bundeslaender', {})).rejects.toThrow('timeout');
    expect(getToken).not.toHaveBeenCalled();
  });
});

describe('createCurriculumTools', () => {
  it('findCurriculum resolves names to ids and returns ≤ 5 curricula with topics', async () => {
    const { tools } = setup();
    const { curricula, sourcesUnavailable } = await tools.findCurriculum({
      state: 'NRW',
      schoolType: 'Grundschule',
      subject: 'Mathematik',
      grade: '4'
    });

    expect(sourcesUnavailable).toEqual([]);
    expect(curricula.length).toBeLessThanOrEqual(5);
    expect(curricula.length).toBeGreaterThan(0);
    for (const c of curricula) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.title).toBe('string');
      expect(Array.isArray(c.topics)).toBe(true);
    }
    expect(curricula.some((c) => c.grades.includes('4'))).toBe(true);
  });

  it('findCurriculum feeds the real captured find_lehrplaene text (not pre-parsed JSON) and finds the RP/Grundschule/Mathematik curriculum', async () => {
    const { tools } = setup();
    const { curricula, sourcesUnavailable } = await tools.findCurriculum({
      state: 'Rheinland-Pfalz',
      schoolType: 'Grundschule',
      subject: 'Mathematik'
    });

    expect(sourcesUnavailable).toEqual([]);
    const match = curricula.find((c) =>
      c.id.endsWith('https://w3id.org/lehrplan/resource/rp/lehrplan-184-1')
    );
    expect(match).toBeDefined();
    expect(match?.title).toBe('Mathematik 1-4');
    expect(match?.grades).toEqual(['1', '2', '3', '4']);
  });

  it('findCurriculum with an unknown Bundesland returns no curricula, sourcesUnavailable only when the call threw', async () => {
    const { tools: toolsEmpty } = setup(async (name) => {
      if (name === 'find_lehrplaene') return 'No results.';
      return FIXTURES[name];
    });
    const empty = await toolsEmpty.findCurriculum({ state: 'Atlantis', subject: 'Mathematik' });
    expect(empty.curricula).toEqual([]);
    expect(empty.sourcesUnavailable).toEqual([]);

    const { tools: toolsThrow } = setup(async (name) => {
      if (name === 'find_lehrplaene') throw new Error('network down');
      return FIXTURES[name];
    });
    const threw = await toolsThrow.findCurriculum({ state: 'Atlantis', subject: 'Mathematik' });
    expect(threw.curricula).toEqual([]);
    expect(threw.sourcesUnavailable).toEqual(['mem']);
  });

  it('findCurriculum names mem in sourcesUnavailable (deduped) when list_bundeslaender itself throws', async () => {
    const { tools } = setup(async (name) => {
      if (name === 'list_bundeslaender' || name === 'find_lehrplaene') throw new Error('timeout');
      return FIXTURES[name];
    });
    const result = await tools.findCurriculum({ state: 'Bayern' });
    expect(result.curricula).toEqual([]);
    // deduped: both list_bundeslaender and find_lehrplaene threw, 'mem' appears once
    expect(result.sourcesUnavailable).toEqual(['mem']);
  });

  it('a MEM tool error (isToolError, e.g. "Unknown Bundesland") is a clean empty answer, not an outage', async () => {
    const { tools: toolsToolError } = setup(async (name) => {
      if (name === 'find_lehrplaene') {
        throw Object.assign(new Error('Unknown Bundesland: "Atlantis".'), { isToolError: true });
      }
      return FIXTURES[name];
    });
    const toolError = await toolsToolError.findCurriculum({
      state: 'Atlantis',
      subject: 'Mathematik'
    });
    expect(toolError).toEqual({ curricula: [], sourcesUnavailable: [] });

    const { tools: toolsTransport } = setup(async (name) => {
      if (name === 'find_lehrplaene') throw new Error('network down');
      return FIXTURES[name];
    });
    const transport = await toolsTransport.findCurriculum({
      state: 'Atlantis',
      subject: 'Mathematik'
    });
    expect(transport).toEqual({ curricula: [], sourcesUnavailable: ['mem'] });
  });

  it('curriculumCompetences returns ≤ 12 {uri,label} with http(s) uris only', async () => {
    const { tools } = setup();
    const { competences, sourcesUnavailable } = await tools.curriculumCompetences({
      curriculumId:
        'Rheinland-Pfalz|Grundschule|Mathematik|https://w3id.org/lehrplan/resource/rp/lehrplan-184-1'
    });

    expect(sourcesUnavailable).toEqual([]);
    expect(competences.length).toBeLessThanOrEqual(12);
    expect(competences.length).toBeGreaterThan(0);
    for (const c of competences) {
      expect(c.uri).toMatch(/^https?:\/\//);
      expect(typeof c.label).toBe('string');
    }
  });

  it('curriculumCompetences with an empty curriculumId returns nothing without calling MEM', async () => {
    const { tools, callTool } = setup();
    const result = await tools.curriculumCompetences({ curriculumId: '' });
    expect(result).toEqual({ competences: [], sourcesUnavailable: [] });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('names are matched case- and umlaut-insensitively ("nordrhein westfalen" → the list_bundeslaender label)', async () => {
    const { tools, callTool } = setup();
    await tools.findCurriculum({ state: 'nordrhein westfalen', subject: 'Mathematik' });

    const findCall = callTool.mock.calls.find(([name]) => name === 'find_lehrplaene');
    expect(findCall).toBeDefined();
    expect(findCall?.[1].bundesland).toBe('Nordrhein-Westfalen');
  });

  it('caches list_* results per instance instead of re-fetching on every call', async () => {
    const { tools, callTool } = setup();
    await tools.findCurriculum({ state: 'Bayern', subject: 'Mathematik' });
    await tools.findCurriculum({ state: 'Bayern', subject: 'Physik' });

    const bundeslaenderCalls = callTool.mock.calls.filter(
      ([name]) => name === 'list_bundeslaender'
    );
    expect(bundeslaenderCalls.length).toBe(1);
  });

  it('an outage is not cached: the next call asks MEM again', async () => {
    let down = true;
    const { tools, callTool } = setup(async (name) => {
      if (down && name === 'list_bundeslaender') throw new Error('timeout');
      return FIXTURES[name];
    });
    expect((await tools.findCurriculum({ state: 'Bayern' })).sourcesUnavailable).toEqual(['mem']);
    down = false;
    const again = await tools.findCurriculum({ state: 'Bayern', subject: 'Mathematik' });
    expect(again.sourcesUnavailable).toEqual([]);
    expect(callTool.mock.calls.filter(([name]) => name === 'list_bundeslaender')).toHaveLength(2);
  });
});

describe('searchCurriculum', () => {
  const OLD =
    's | label | parent | parentLabel\n---\n' +
    'https://w3id.org/lehrplan/resource/by/1 | Prinzip der Nachhaltigkeit:<br> ökologisch |  | \n' +
    'https://w3id.org/lehrplan/resource/by/2 | Nachhaltigkeit, Lebensqualität |  | \n\n' +
    '(Results limited to 50. Try a more specific query or add filters.)';
  const NEW =
    's | label | parentLabel | lp | lpLabel | bundesland | schulart | schulfach | jahrgangsstufe\n---\n' +
    'https://w3id.org/lehrplan/resource/by/3 | Wirtschaft | a | b | Lernbereich 2 | https://w3id.org/lehrplan/by/gym/geo | Geographie 7 | Bayern | Gymnasium | Geographie | jg7\n' +
    'https://w3id.org/lehrplan/resource/by/4 | Ernährung | Lernbereich 1 | https://w3id.org/lehrplan/by/ms/aes | AES 8 | Bayern | Mittelschule | Ernährung und Soziales | Jahrgangsstufe 8\n' +
    'javascript:alert(1) | evil | | | | | | |';

  /** @param {string} text */
  const withSearch = (text) => setup(async (name) => (name === 'search' ? text : FIXTURES[name]));

  it('old header shape → entries with uri and label only (no context), footer dropped', async () => {
    const { tools } = withSearch(OLD);
    const { entries, sourcesUnavailable } = await tools.searchCurriculum({
      query: 'Nachhaltigkeit'
    });
    expect(sourcesUnavailable).toEqual([]);
    expect(entries).toEqual([
      {
        uri: 'https://w3id.org/lehrplan/resource/by/1',
        label: 'Prinzip der Nachhaltigkeit: ökologisch'
      },
      { uri: 'https://w3id.org/lehrplan/resource/by/2', label: 'Nachhaltigkeit, Lebensqualität' }
    ]);
  });

  it('new header shape → full context, "jg7" normalised, a "|" in the label kept, non-http rows dropped', async () => {
    const { tools } = withSearch(NEW);
    const { entries } = await tools.searchCurriculum({ query: 'Nachhaltigkeit', state: 'Bayern' });
    expect(entries).toEqual([
      {
        uri: 'https://w3id.org/lehrplan/resource/by/3',
        label: 'Wirtschaft | a | b',
        parent: 'Lernbereich 2',
        curriculum: { uri: 'https://w3id.org/lehrplan/by/gym/geo', title: 'Geographie 7' },
        state: 'Bayern',
        schoolType: 'Gymnasium',
        subject: 'Geographie',
        grade: 'Jahrgangsstufe 7'
      },
      {
        uri: 'https://w3id.org/lehrplan/resource/by/4',
        label: 'Ernährung',
        parent: 'Lernbereich 1',
        curriculum: { uri: 'https://w3id.org/lehrplan/by/ms/aes', title: 'AES 8' },
        state: 'Bayern',
        schoolType: 'Mittelschule',
        subject: 'Ernährung und Soziales',
        grade: 'Jahrgangsstufe 8'
      }
    ]);
  });

  it('strips MEM emphasis markers and <br> from label, parent and Lehrplan title alike', async () => {
    const { tools } = withSearch(
      's | label | parentLabel | lp | lpLabel | bundesland | schulart | schulfach | jahrgangsstufe\n---\n' +
        'https://w3id.org/lehrplan/resource/by/9 | Prinzip der //Nachhaltigkeit\\\\:<br> Labels | //Konsum\\ und Handel | https://w3id.org/lehrplan/by/rs/soz | Soziallehre //8\\\\ | Bayern | Realschule | Soziallehre | Jahrgangsstufe 8'
    );
    const [e] = (await tools.searchCurriculum({ query: 'Nachhaltigkeit' })).entries;
    expect(e.label).toBe('Prinzip der Nachhaltigkeit: Labels');
    expect(e.parent).toBe('Konsum und Handel');
    expect(e.curriculum?.title).toBe('Soziallehre 8');
  });

  it('caps at 15 entries and the query at 120 trimmed chars', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => `https://x/${i} | L${i} |  | `).join('\n');
    const { tools, callTool } = withSearch(`s | label | parent | parentLabel\n---\n${rows}`);
    const { entries } = await tools.searchCurriculum({ query: `  ${'q'.repeat(200)}  ` });
    expect(entries).toHaveLength(15);
    expect(callTool).toHaveBeenCalledWith('search', { query: 'q'.repeat(120) });
  });

  it('"No results found" → empty, not unavailable; a throw → unavailable', async () => {
    const empty = withSearch('No results found for "xyz".');
    expect(await empty.tools.searchCurriculum({ query: 'xyz' })).toEqual({
      entries: [],
      sourcesUnavailable: []
    });
    const down = setup(async () => {
      throw new Error('timeout');
    });
    expect(await down.tools.searchCurriculum({ query: 'xyz' })).toEqual({
      entries: [],
      sourcesUnavailable: ['mem']
    });
  });

  it('forwards filters as bundesland/schulart/schulfach resolved to MEM names', async () => {
    const { tools, callTool } = withSearch(OLD);
    await tools.searchCurriculum({
      query: 'Brüche',
      state: 'bayern',
      schoolType: 'grundschule',
      subject: 'mathematik'
    });
    expect(callTool).toHaveBeenCalledWith('search', {
      query: 'Brüche',
      bundesland: 'Bayern',
      schulart: 'Grundschule',
      schulfach: 'Mathematik'
    });
  });

  it('never sends schulart/schulfach without a bundesland, and no query = no call', async () => {
    const { tools, callTool } = withSearch(OLD);
    await tools.searchCurriculum({
      query: 'Brüche',
      schoolType: 'Grundschule',
      subject: 'Mathematik'
    });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith('search', { query: 'Brüche' });
    callTool.mockClear();
    expect((await tools.searchCurriculum({ query: '  ' })).entries).toEqual([]);
    expect(callTool).not.toHaveBeenCalled();
  });
});

describe('list tools with MEM 2.1 columns', () => {
  const NEW_LIST =
    'code | label | uri | hasData\n---\n' +
    'BY | Bayern | https://w3id.org/lehrplan/ontology/LP_3000051 | true\n' +
    'BE | Berlin | https://w3id.org/lehrplan/ontology/LP_3000048 | false';

  it('resolves a state by its label column, not the first column', async () => {
    const callTool = vi.fn(async (/** @type {string} */ name) =>
      name === 'list_bundeslaender'
        ? NEW_LIST
        : name === 'search'
          ? 'No results found for "x".'
          : 'uri | label\n---\n'
    );
    const tools = createCurriculumTools({ callTool });
    await tools.searchCurriculum({ query: 'Wasser', state: 'bayern' });
    expect(callTool).toHaveBeenCalledWith('search', { query: 'Wasser', bundesland: 'Bayern' });
  });
});
