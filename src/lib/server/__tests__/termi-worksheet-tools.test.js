/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  createWorksheetTools,
  worksheetMcpCaller,
  worksheetMcpEnv
} from '../termi/worksheet-tools.js';

const DRAFT = 'aOjzQVsKfzATxtomEW1ZcA';
const LINK = `https://worksheet.example/draft/${DRAFT}`;
const MADE = { draft: DRAFT, link: LINK, added: ['330bf69b'], outline: 'Sheet "T", A4 upright' };

/** @param {(name: string, args: any) => Promise<any>} impl */
function setup(impl) {
  const callTool = vi.fn(impl);
  return { callTool, tools: createWorksheetTools({ callTool }) };
}
const toolError = (/** @type {string} */ message) =>
  Object.assign(new Error(message), { isToolError: true });

describe('worksheetMcpEnv', () => {
  it('is off unless WORKSHEET_MCP_URL names a server', () => {
    expect(worksheetMcpEnv({})).toEqual({ mcpUrl: undefined });
    expect(worksheetMcpEnv({ WORKSHEET_MCP_URL: 'none' })).toEqual({ mcpUrl: undefined });
    expect(worksheetMcpEnv({ WORKSHEET_MCP_URL: ' https://mcp.example/mcp ' })).toEqual({
      mcpUrl: 'https://mcp.example/mcp'
    });
  });
});

describe('worksheetMcpCaller', () => {
  it('calls the server without a token', async () => {
    const callTool = vi.fn(async () => ({ types: [] }));
    await worksheetMcpCaller({ mcpUrl: 'https://mcp.example/mcp', callTool })(
      'list_block_types',
      {}
    );
    expect(callTool).toHaveBeenCalledWith({
      mcpUrl: 'https://mcp.example/mcp',
      bearerToken: undefined,
      name: 'list_block_types',
      args: {}
    });
  });
});

describe('createWorksheetTools', () => {
  it('hands the block reference through', async () => {
    const { tools, callTool } = setup(async (name) => ({ types: [{ type: name }] }));
    expect(await tools.listBlockTypes()).toEqual({ types: [{ type: 'list_block_types' }] });
    expect(await tools.describeBlockTypes(['cloze', 7, 'task'])).toEqual({
      types: [{ type: 'describe_block_types' }]
    });
    expect(callTool).toHaveBeenLastCalledWith('describe_block_types', { types: ['cloze', 'task'] });
  });

  it('a made sheet answers with draft, link and outline', async () => {
    const { tools, callTool } = setup(async () => MADE);
    const ops = [{ op: 'addBlock', type: 'heading' }];
    expect(await tools.createSheet({ title: 'T', operations: ops })).toEqual({
      draft: DRAFT,
      link: LINK,
      outline: MADE.outline
    });
    expect(callTool).toHaveBeenCalledWith('create_sheet', { title: 'T', operations: ops });
    await tools.changeSheet({ draft: DRAFT, operations: ops });
    expect(callTool).toHaveBeenLastCalledWith('change_sheet', { draft: DRAFT, operations: ops });
  });

  it("the checker's sentences reach the model as problems, so it can correct the list", async () => {
    const { tools } = setup(async () => {
      throw toolError('Nothing was changed. 1 problem:\n- ops[1].data.text: no such key');
    });
    expect(await tools.createSheet({ title: 'T', operations: [] })).toEqual({
      problems: 'Nothing was changed. 1 problem:\n- ops[1].data.text: no such key'
    });
  });

  it('a server that cannot be reached is reported as unavailable, never as problems', async () => {
    const { tools } = setup(async () => {
      throw new Error('fetch failed');
    });
    const down = { sourcesUnavailable: ['worksheet'] };
    expect(await tools.listBlockTypes()).toEqual(down);
    expect(await tools.describeBlockTypes(['task'])).toEqual(down);
    expect(await tools.createSheet({ title: 'T', operations: [] })).toEqual(down);
    expect(await tools.changeSheet({ draft: DRAFT, operations: [] })).toEqual(down);
  });

  it('an answer without a usable draft link is unavailable: no button may point elsewhere', async () => {
    for (const bad of [
      { ...MADE, link: 'javascript:alert(1)' },
      { ...MADE, link: `http://worksheet.example/draft/${DRAFT}` },
      { ...MADE, link: 'https://worksheet.example/draft/other' },
      { ...MADE, draft: '../x' },
      'text'
    ]) {
      const { tools } = setup(async () => bad);
      expect(await tools.createSheet({ title: 'T', operations: [] })).toEqual({
        sourcesUnavailable: ['worksheet']
      });
    }
  });

  it('change_sheet refuses a draft id of the wrong shape without asking the server', async () => {
    const { tools, callTool } = setup(async () => MADE);
    expect(await tools.changeSheet({ draft: 'nope', operations: [] })).toEqual({
      problems: expect.stringContaining('draft')
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('what is not a list of operations is sent as an empty list', async () => {
    const { tools, callTool } = setup(async () => MADE);
    await tools.createSheet({ title: 7, operations: 'x' });
    expect(callTool).toHaveBeenCalledWith('create_sheet', { title: '', operations: [] });
  });
});
