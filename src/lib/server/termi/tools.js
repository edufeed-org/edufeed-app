/**
 * AI SDK tools for the Termi assistant, per task: `ask` (the six knowledge
 * tools; the chat route maps the old `search` task onto it).
 */
import { jsonSchema, tool } from 'ai';
import { callNopeMcpTool } from '../nopeMcpClient.js';
import { createKnowledgeTools, DEFAULT_SEARCH_RELAYS, nopeMcpCaller } from './knowledge-tools.js';
import { TERMI_SKILLS } from '../../helpers/termi-skills.js';

const LICENSE_FILTERS = ['open', 'cc-any', 'any'];

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

/** Navigate/create skill ids `show_pages` may name — never a help skill. */
export function pageSkillIds() {
  return TERMI_SKILLS.filter((s) => s.kind !== 'help').map((s) => s.id);
}

/** `show_pages({ ids })`: one LLM step answers "where is my X" with real page buttons. */
function showPagesTool() {
  const skills = TERMI_SKILLS.filter((s) => s.kind !== 'help');
  const description = `Zeigt der Nutzerin/dem Nutzer App-Seiten als Buttons (höchstens zwei ids). Ids: ${skills
    .map((s) => `${s.id} — ${s.phrases.de.slice(0, 3).join('; ')}`)
    .join(' | ')}`;
  return tool({
    description,
    inputSchema: schema(
      {
        ids: {
          type: 'array',
          maxItems: 2,
          items: { type: 'string', enum: pageSkillIds() }
        }
      },
      ['ids']
    ),
    // The SDK enforces the enum, but a tool result is still untrusted model
    // output: never pass it to the client unfiltered.
    execute: async (/** @type {any} */ input) => {
      const allowed = new Set(pageSkillIds());
      const ids = (Array.isArray(input?.ids) ? input.ids : [])
        .filter((/** @type {string} */ id) => allowed.has(id))
        .slice(0, 2);
      return { ids };
    }
  });
}

/**
 * @param {{ mcpUrl: string, getToken: () => Promise<string>, callTool?: typeof callNopeMcpTool, relays?: string[], now?: () => number }} deps
 */
function buildAskTools({ mcpUrl, getToken, callTool = callNopeMcpTool, relays, now }) {
  const call = nopeMcpCaller({ mcpUrl, getToken, callTool });
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
        },
        authors: {
          type: 'array',
          maxItems: 5,
          items: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          description: 'Nur Inhalte dieser Personen (hex-pubkeys, z. B. aus find_people)'
        }
      },
      ['query'],
      (i) =>
        k.searchContent(text(i.query), {
          types: Array.isArray(i.types) ? i.types : [],
          authors: i.authors
        })
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
    ),
    show_pages: showPagesTool()
  };
}

/**
 * @param {'ask'} task
 * @param {{ mcpUrl: string, getToken: () => Promise<string>, callTool?: typeof callNopeMcpTool, relays?: string[], now?: () => number }} deps
 */
export function buildTermiTools(task, deps) {
  if (task !== 'ask') throw new Error(`unknown Termi task: ${task}`);
  return buildAskTools(deps);
}
