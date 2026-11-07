/**
 * AI SDK tools for the Termi assistant, per task: `ask` (the six knowledge
 * tools) and `search` (the Plan 1 single tool, kept until the chat route
 * switches to `ask`).
 */
import { jsonSchema, tool } from 'ai';
import { callNopeMcpTool } from '../nopeMcpClient.js';
import { createKnowledgeTools, DEFAULT_SEARCH_RELAYS } from './knowledge-tools.js';

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

const MAX_MODEL_ITEMS = 8;

/** @param {Record<string, any>} properties @param {string[]} required */
const schema = (properties, required) =>
  jsonSchema(/** @type {any} */ ({ type: 'object', properties, required }));

/** Model output is untrusted: only a short string survives. @param {unknown} v */
const text = (v) => (typeof v === 'string' ? v.slice(0, 300) : '');

/**
 * @param {string} description
 * @param {Record<string, any>} properties
 * @param {string[]} required
 * @param {(input: any) => Promise<import('./knowledge-tools.js').ToolResult>} run
 */
function knowledgeTool(description, properties, required, run) {
  return tool({
    description,
    inputSchema: schema(properties, required),
    execute: async (/** @type {any} */ input) => {
      const { items, sourcesUnavailable } = await run(input ?? {});
      return { items: items.slice(0, MAX_MODEL_ITEMS), sourcesUnavailable };
    }
  });
}

/**
 * @param {{ mcpUrl: string, getToken: () => Promise<string>, callTool?: typeof callNopeMcpTool, relays?: string[], now?: () => number }} deps
 */
function buildAskTools({ mcpUrl, getToken, callTool = callNopeMcpTool, relays, now }) {
  /** Anonymous first; a client-credentials token only when the server demands one. @param {string} name @param {object} args */
  async function call(name, args) {
    try {
      return await callTool({ mcpUrl, bearerToken: undefined, name, args });
    } catch (err) {
      if (/** @type {any} */ (err)?.status !== 401) throw err;
      return callTool({ mcpUrl, bearerToken: await getToken(), name, args });
    }
  }
  const k = createKnowledgeTools({ callTool: call, relays, now });
  const query = { type: 'string', description: 'Suchbegriffe (nur das Thema)' };

  return {
    search_content: knowledgeTool(
      'Sucht Bildungsmaterialien, Artikel, Wikis, Projekte, Maßnahmen und Publikationen im Edufeed-Netzwerk.',
      {
        query,
        types: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['resource', 'article', 'wiki', 'project', 'measure', 'publication']
          }
        }
      },
      ['query'],
      (i) => k.searchContent(text(i.query), { types: Array.isArray(i.types) ? i.types : [] })
    ),
    search_resources: knowledgeTool(
      'Sucht Lernmaterialien (OER) mit Filtern nach Fach, Materialart, Bildungsstufe, Urheber oder Herausgeber.',
      {
        query,
        subjectLabel: { type: 'string' },
        resourceTypeLabel: { type: 'string' },
        educationalLevelLabel: { type: 'string' },
        creatorName: { type: 'string' },
        publisherName: { type: 'string' },
        licenseFilter: { type: 'string', enum: LICENSE_FILTERS }
      },
      ['query'],
      (i) => {
        const { query: q, ...filters } = i;
        const clean = Object.fromEntries(Object.entries(filters).map(([key, v]) => [key, text(v)]));
        if (!LICENSE_FILTERS.includes(clean.licenseFilter)) delete clean.licenseFilter;
        return k.searchResources(text(q), clean);
      }
    ),
    search_events: knowledgeTool(
      'Sucht kommende Veranstaltungen (Fortbildungen, Workshops, Tagungen) im Edufeed-Kalender.',
      {
        query,
        level: {
          type: 'string',
          description:
            'KIM-Bildungsstufe als URI, z. B. https://w3id.org/kim/educationalLevel/level_C (Fortbildung)'
        }
      },
      ['query'],
      (i) => k.searchEvents(text(i.query), { level: text(i.level) || undefined })
    ),
    search_passages: knowledgeTool(
      'Findet Textstellen aus offenen Materialien, die eine Frage beantworten ("wie/was kann ich …"), mit Quelle, Herausgeber und Lizenz.',
      {
        question: { type: 'string' },
        relay: { type: 'string', enum: relays ?? DEFAULT_SEARCH_RELAYS }
      },
      ['question'],
      (i) => k.searchPassages(text(i.question), { relay: text(i.relay) || undefined })
    ),
    find_community: knowledgeTool(
      'Findet Communities im Edufeed-Netzwerk zu einem Thema ("welche Community …").',
      { query },
      ['query'],
      (i) => k.findCommunity(text(i.query))
    ),
    find_people: knowledgeTool(
      'Findet Personen oder Organisationen im Nostr-Netzwerk nach Namen.',
      { name: { type: 'string' } },
      ['name'],
      (i) => k.findPeople(text(i.name))
    )
  };
}

/**
 * @param {'ask' | 'search'} task
 * @param {{ mcpUrl: string, getToken: () => Promise<string>, callTool?: typeof callNopeMcpTool, relays?: string[], now?: () => number }} deps
 */
export function buildTermiTools(task, deps) {
  if (task === 'ask') return buildAskTools(deps);
  if (task !== 'search') throw new Error(`unknown Termi task: ${task}`);
  const { mcpUrl, getToken, callTool = callNopeMcpTool } = deps;

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
