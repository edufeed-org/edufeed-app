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
});
