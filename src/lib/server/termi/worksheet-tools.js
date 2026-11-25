/**
 * Worksheet tools for the Termi `ask` task: the model builds a printable sheet in the
 * edufeed worksheet editor through that editor's MCP server (worksheet-mcp: `list_block_types`,
 * `describe_block_types`, `create_sheet`, `change_sheet`). The server keeps the sheet as a draft
 * and answers with a link; the teacher opens it in the editor. Server-side only, over the MCP
 * client used for nope-mcp. The server is anonymous: no token is ever sent.
 *
 * What the model wrote goes to the server as it is: the server checks every operation and
 * answers a wrong list with sentences that say what to send instead (an MCP tool error). Those
 * sentences go back to the model as `problems`, so it can correct the list.
 */
import { sheetOf } from '../../termi/tool-registry.js';
import { callNopeMcpTool } from '../nopeMcpClient.js';

const MAX_PROBLEMS = 4000;
const DOWN = { sourcesUnavailable: ['worksheet'] };

/** `WORKSHEET_MCP_URL` env; unset or `none` = the worksheet tools are off. @param {Record<string, string | undefined>} env */
export function worksheetMcpEnv(env) {
  const url = env?.WORKSHEET_MCP_URL?.trim();
  return { mcpUrl: url && url !== 'none' ? url : undefined };
}

/**
 * `(name, args) => Promise<any>` over worksheet-mcp.
 * @param {{ mcpUrl: string, callTool?: typeof callNopeMcpTool }} deps
 */
export function worksheetMcpCaller({ mcpUrl, callTool = callNopeMcpTool }) {
  return (/** @type {string} */ name, /** @type {object} */ args) =>
    callTool({ mcpUrl, bearerToken: undefined, name, args });
}

/** @param {{ callTool: (name: string, args: Record<string, any>) => Promise<any> }} deps */
export function createWorksheetTools({ callTool }) {
  /**
   * @param {string} name @param {Record<string, any>} args
   * @param {(result: any) => object | null} read null = an answer that cannot be used
   */
  async function call(name, args, read) {
    try {
      return read(await callTool(name, args)) ?? DOWN;
    } catch (err) {
      if (!(/** @type {any} */ (err)?.isToolError)) return DOWN;
      return { problems: String(/** @type {any} */ (err).message).slice(0, MAX_PROBLEMS) };
    }
  }
  /** @param {any} r */
  const reference = (r) => (r && typeof r === 'object' ? r : null);
  /** @param {unknown} v */
  const list = (v) => (Array.isArray(v) ? v : []);

  return {
    listBlockTypes: () => call('list_block_types', {}, reference),
    /** @param {unknown} types */
    describeBlockTypes: (types) =>
      call(
        'describe_block_types',
        { types: list(types).filter((t) => typeof t === 'string') },
        reference
      ),
    /** @param {{ title?: unknown, operations?: unknown }} input */
    createSheet: ({ title, operations } = {}) =>
      call(
        'create_sheet',
        {
          title: typeof title === 'string' ? title.slice(0, 200) : '',
          operations: list(operations)
        },
        sheetOf
      ),
    /** @param {{ draft?: unknown, operations?: unknown }} input */
    changeSheet: async ({ draft, operations } = {}) => {
      if (typeof draft !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(draft)) {
        return { problems: 'draft: not a draft id. Send the "draft" that create_sheet answered.' };
      }
      return call('change_sheet', { draft, operations: list(operations) }, sheetOf);
    }
  };
}
