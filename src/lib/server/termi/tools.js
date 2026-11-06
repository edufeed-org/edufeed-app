/**
 * AI SDK tools for the Termi assistant, per task. Only `search` exists so far.
 */
import { jsonSchema, tool } from 'ai';
import { callNopeMcpTool } from '../nopeMcpClient.js';

const LICENSE_FILTERS = ['open', 'cc-any', 'any'];
const MAX_LIMIT = 10;

/** @param {{ name?: string }[] | undefined} entities */
function names(entities) {
  const list = (entities ?? []).map((e) => e?.name).filter(Boolean);
  return list.length > 0 ? list.join(', ') : undefined;
}

/**
 * nope-mcp's simplified resource (amb-mcp `toSimplifiedResource`) → the
 * compact hit the model sees. Undefined fields drop out of the JSON.
 * @param {any} r
 */
function toHit(r) {
  return {
    title: r.name,
    description: r.description,
    license: r.license?.label,
    creator: names(r.creator),
    publisher: names(r.publisher),
    url: r.url,
    sourcePage: r.sourcePage
  };
}

/**
 * @param {'search'} task
 * @param {{ mcpUrl: string, getToken: () => Promise<string>, callTool?: typeof callNopeMcpTool }} deps
 */
export function buildTermiTools(task, { mcpUrl, getToken, callTool = callNopeMcpTool }) {
  if (task !== 'search') throw new Error(`unknown Termi task: ${task}`);

  return {
    search_resources: tool({
      description:
        'Sucht offene Bildungsmaterialien (OER) im Edufeed-Netzwerk. Gibt Treffer mit Titel, Beschreibung, Lizenz, Urheber, Herausgeber und Links zurück.',
      inputSchema: jsonSchema(
        /** @type {const} */ ({
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Suchbegriffe, z. B. "Bruchrechnung Klasse 6"' },
            licenseFilter: {
              type: 'string',
              enum: LICENSE_FILTERS,
              description: 'Lizenzfilter; Standard "open" (CC0, CC BY, CC BY-SA, Public Domain)'
            },
            limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: 'Standard 5' }
          },
          required: ['query']
        })
      ),
      execute: async (/** @type {any} */ input) => {
        // Model output is untrusted: clamp before it reaches nope-mcp.
        const args = {
          query: String(input?.query ?? ''),
          licenseFilter: LICENSE_FILTERS.includes(input?.licenseFilter)
            ? input.licenseFilter
            : 'open',
          limit: Math.min(Math.max(Math.trunc(Number(input?.limit)) || 5, 1), MAX_LIMIT)
        };
        /** @param {string | undefined} bearerToken */
        const call = (bearerToken) =>
          callTool({ mcpUrl, bearerToken, name: 'search_resources', args });
        let result;
        try {
          result = await call(undefined);
        } catch (err) {
          if (/** @type {any} */ (err)?.status !== 401) throw err;
          result = await call(await getToken());
        }
        return { hits: (result?.resources ?? []).map(toHit) };
      }
    })
  };
}
