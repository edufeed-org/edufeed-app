/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { buildTermiTools } from '../termi/tools.js';

const NOPE_RESULT = {
  total: 2,
  resources: [
    {
      name: 'Bruchrechnung',
      description: 'Arbeitsblatt',
      url: 'https://edufeed.org/naddr1x',
      sourcePage: 'https://example.org/bruch',
      creator: [
        { name: 'Ada', type: 'Person' },
        { name: 'Bob', type: 'Person' }
      ],
      publisher: [{ name: 'ZUM', type: 'Organization' }],
      license: { id: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' },
      accessLevel: 'full',
      nostr: { eventId: 'e', pubkey: 'p', createdAt: 1 }
    },
    { name: 'Ohne Lizenz', license: null }
  ]
};

/** @param {{ callTool?: any, getToken?: any }} [deps] */
function tools(deps = {}) {
  return buildTermiTools('search', {
    mcpUrl: 'https://mcp.example/mcp',
    callTool: deps.callTool ?? vi.fn(async () => NOPE_RESULT),
    getToken: deps.getToken ?? vi.fn(async () => 'tok')
  });
}

/** @param {any} t @param {any} args @returns {Promise<any>} */
const run = (t, args) => t.execute(args, { toolCallId: 'c', messages: [] });

describe('buildTermiTools', () => {
  it('exposes exactly search_resources for the search task', () => {
    expect(Object.keys(tools())).toEqual(['search_resources']);
  });

  it('calls nope-mcp anonymously with open license and limit 5 by default', async () => {
    const callTool = vi.fn(async () => NOPE_RESULT);
    const getToken = vi.fn();
    await run(tools({ callTool, getToken }).search_resources, { query: 'Bruch' });
    expect(callTool).toHaveBeenCalledWith({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: undefined,
      name: 'search_resources',
      args: { query: 'Bruch', licenseFilter: 'open', limit: 5 }
    });
    expect(getToken).not.toHaveBeenCalled();
  });

  it('clamps a model-supplied limit and licenseFilter', async () => {
    const callTool = vi.fn(async () => NOPE_RESULT);
    await run(tools({ callTool }).search_resources, {
      query: 'x',
      limit: 500,
      licenseFilter: 'bogus'
    });
    expect(/** @type {any} */ (callTool.mock.calls[0])[0].args).toEqual({
      query: 'x',
      licenseFilter: 'open',
      limit: 10
    });
  });

  it('retries once with a client-credentials token on a 401', async () => {
    const unauthorized = Object.assign(new Error('MCP initialize failed: HTTP 401'), {
      status: 401
    });
    const callTool = vi.fn().mockRejectedValueOnce(unauthorized).mockResolvedValueOnce(NOPE_RESULT);
    const getToken = vi.fn(async () => 'tok');
    const out = await run(tools({ callTool, getToken }).search_resources, { query: 'x' });
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool.mock.calls[1][0].bearerToken).toBe('tok');
    expect(out.hits).toHaveLength(2);
  });

  it('does not retry other failures', async () => {
    const callTool = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('HTTP 500'), { status: 500 }));
    const getToken = vi.fn();
    await expect(
      run(tools({ callTool, getToken }).search_resources, { query: 'x' })
    ).rejects.toThrow();
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(getToken).not.toHaveBeenCalled();
  });

  it('maps nope-mcp resources to compact hits', async () => {
    const out = await run(tools().search_resources, { query: 'x' });
    expect(out).toEqual({
      hits: [
        {
          title: 'Bruchrechnung',
          description: 'Arbeitsblatt',
          license: 'CC BY 4.0',
          creator: 'Ada, Bob',
          publisher: 'ZUM',
          url: 'https://edufeed.org/naddr1x',
          sourcePage: 'https://example.org/bruch'
        },
        { title: 'Ohne Lizenz' }
      ]
    });
  });
});
