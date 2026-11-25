/**
 * AI SDK tools for the Termi assistant, per task: the tools named in
 * `TERMI_TASKS[task].tools` — `ask` gets the six knowledge tools plus
 * `show_pages` and the MEM curriculum tools, `lesson` the MEM curriculum tools
 * (both only with `memUrl`), `ask` also the four worksheet tools (only with `worksheetUrl`),
 * three nope-mcp searches, `propose_options` and `lesson_state`.
 */
import { jsonSchema, tool } from 'ai';
import { callNopeMcpTool } from '../nopeMcpClient.js';
import { createKnowledgeTools, DEFAULT_SEARCH_RELAYS, nopeMcpCaller } from './knowledge-tools.js';
import { createCurriculumTools, memMcpCaller } from './curriculum-tools.js';
import { createWorksheetTools, worksheetMcpCaller } from './worksheet-tools.js';
import { TERMI_TASKS } from './tasks.js';
import { TERMI_SKILLS } from '../../helpers/termi-skills.js';
import { TOOL_REGISTRY } from '../../termi/tool-registry.js';
import { sanitizeLessonPatch } from '../../termi/lesson-state.js';

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
      const { items, sourcesUnavailable, note } = await run(input ?? {});
      return {
        items: items.slice(0, MAX_MODEL_ITEMS),
        sourcesUnavailable,
        ...(note ? { note } : {})
      };
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
 * One curriculum-tools instance per MEM URL, so its 10-min `list_*` cache
 * outlives a request. The first caller's getToken/callTool are kept — in the
 * route they are module constants.
 * @type {Map<string, ReturnType<typeof createCurriculumTools>>}
 */
const curriculumInstances = new Map();

/** Test hook: forget the per-URL instances. */
export function _resetCurriculumToolsForTests() {
  curriculumInstances.clear();
}

/** @param {Deps} deps */
function curriculumInstance({ memUrl, getToken, callTool = callNopeMcpTool }) {
  const url = /** @type {string} */ (memUrl);
  let c = curriculumInstances.get(url);
  if (!c) {
    c = createCurriculumTools({ callTool: memMcpCaller({ mcpUrl: url, getToken, callTool }) });
    curriculumInstances.set(url, c);
  }
  return c;
}

/** MEM curriculum tool factories over the MCP client (anonymous first, token on 401). @param {Deps} deps */
function curriculumTools(deps) {
  const instance = () => curriculumInstance(deps);
  return {
    find_curriculum: () =>
      tool({
        description:
          'Findet Lehrpläne (MEM) zu Bundesland, Schulart, Fach und Jahrgangsstufe. Gibt je Lehrplan eine id für curriculum_competences zurück.',
        inputSchema: schema(
          {
            state: { type: 'string', description: 'Bundesland, z. B. Bayern' },
            schoolType: { type: 'string', description: 'Schulart, z. B. Grundschule' },
            subject: { type: 'string', description: 'Fach, z. B. Mathematik' },
            grade: { type: 'string', description: 'Jahrgangsstufe, z. B. 4' }
          },
          ['state']
        ),
        execute: async (/** @type {any} */ i) =>
          instance().findCurriculum({
            state: text(i?.state),
            schoolType: text(i?.schoolType) || undefined,
            subject: text(i?.subject) || undefined,
            grade: text(i?.grade) || undefined
          })
      }),
    curriculum_competences: () =>
      tool({
        description:
          'Liest die Kompetenzen eines Lehrplans aus find_curriculum (curriculumId = dessen id, unverändert).',
        inputSchema: schema(
          {
            curriculumId: { type: 'string' },
            grade: { type: 'string', description: 'Jahrgangsstufe, z. B. 4' }
          },
          ['curriculumId']
        ),
        execute: async (/** @type {any} */ i) =>
          instance().curriculumCompetences({
            curriculumId: text(i?.curriculumId),
            grade: text(i?.grade) || undefined
          })
      }),
    search_curriculum: () =>
      tool({
        description:
          'Sucht in Lehrplänen (MEM), wo ein Thema vorkommt (Volltext über Lehrplaneinträge). Gibt je Treffer Text, Lehrplan, Bundesland, Schulart, Fach und Jahrgangsstufe zurück, soweit bekannt. / Full-text search of German curricula for a topic.',
        inputSchema: schema(
          {
            query: { type: 'string', description: 'Thema, z. B. Nachhaltigkeit' },
            state: { type: 'string', description: 'Bundesland, z. B. Bayern' },
            schoolType: {
              type: 'string',
              description: 'Schulart, z. B. Gymnasium (nur mit state)'
            },
            subject: { type: 'string', description: 'Fach, z. B. Geographie (nur mit state)' }
          },
          ['query']
        ),
        execute: async (/** @type {any} */ i) =>
          instance().searchCurriculum({
            query: text(i?.query),
            state: text(i?.state) || undefined,
            schoolType: text(i?.schoolType) || undefined,
            subject: text(i?.subject) || undefined
          })
      })
  };
}

// The texts worksheet-mcp gives its own clients, copied from its `tools/list` and server
// instructions (worksheet-editor `mcp/server.js`, mcp-v0.1.0) — Termi sends single tool calls and
// never sees them otherwise. English on purpose: they name keys and operations as the server does.
const SHEET_OPERATIONS =
  'Each operation is an object { "op": <name>, …arguments }. All of them are applied, or none. The operations:\n- addBlock: type, page, x, y, w, h, data, style\n- updateData: id, data\n- updateStyle: ids, style\n- updateBlock: id, x, y, w, h\n- removeBlocks: ids\n- reorder: id, to\n- moveToPage: ids, page\n- setTitle: title\n- updatePage: page\n- updateDefaults: defaults\n- addPage: no arguments\n- removePage: page\naddBlock: "type" is a block type; "data" (optional) are its keys from describe_block_types; "style" (optional) its styles; "page" (optional) a page index from 0, default the last page; "x" and "y" (optional, both or neither) a position in mm; "w" and "h" (optional) a size in mm. updateData merges "data" into the block "id". updateStyle merges "style" into the blocks "ids". updateBlock moves or resizes block "id" with x, y, w, h in mm. removeBlocks removes "ids". reorder puts block "id" "to" the "front" or "back". moveToPage puts "ids" onto page index "page". setTitle sets "title". updatePage takes "page": { margin, margins: { top, right, bottom, left }, landscape, punch }. updateDefaults takes "defaults": { font, fontSize, lang, hyphens }. addPage adds an empty page at the end; removePage removes page index "page".\nExample: [{ "op": "addBlock", "type": "heading", "data": { "text": "Hauptstädte Europas" } }, { "op": "addBlock", "type": "cloze", "data": { "prompt": "Fülle die Lücken.", "body": "Die Hauptstadt von Frankreich ist [Paris]." } }]';
const SHEET_RULES =
  'Rules for a good sheet:\n- Blocks are stacked top to bottom in the order you add them. Leave x and y out, unless two blocks should stand side by side: then give both blocks x, y (and set w with updateBlock) in millimetres from the top left of the content area, which is 170 × 257 mm on upright A4.\n- A task you stack takes the full width; other blocks keep their type\'s usual width.\n- Send every text a block shows. A key you leave out keeps the editor\'s German sample text.\n- Where a key is "rich text", send a plain string: each line is a paragraph, and a word in [square brackets] is a gap the pupil fills in ("Die Hauptstadt von Frankreich ist [Paris]."). The solution sheet shows the word.\n- Tasks are numbered by the editor. Do not write "Aufgabe 1" or "1." into a prompt.\n- "points" is the number of points a task gives, or null.\n- An open question is a "task" with the question as "prompt" and a model answer in "answer". The answer only shows on the solution sheet; the room it needs is kept free under the question, and that is where pupils write. Do not add a "writing-area" for the same question, unless the teacher asks for ruled lines.\n- describe_block_types gives each type\'s size. A height that is "fixed" does not follow the content: give such a block "h" in addBlock (a writing-area needs about 10 mm per line) and usually "w": 170.\n- Write arrows and signs as characters (→, ·, ², CO₂), never as --> or ^2. A formula on a line of its own is a "formula" block (LaTeX).\n- Write the sheet\'s texts in the language the teacher writes in (usually German).\n- Images, logos and backgrounds cannot be placed by you. Say so, and that the teacher can add them in the editor.\n- When a call answers with problems, nothing was changed. Each problem names its place (ops[2].data.…) and what is allowed: correct the list and send all of it again.';

/** One worksheet-tools instance per server address (it holds nothing but the caller). @type {Map<string, ReturnType<typeof createWorksheetTools>>} */
const worksheetInstances = new Map();

/** Worksheet tool factories over the MCP client; the server is anonymous. @param {Deps} deps */
function worksheetTools({ worksheetUrl, callTool = callNopeMcpTool }) {
  const url = /** @type {string} */ (worksheetUrl);
  const instance = () => {
    let w = worksheetInstances.get(url);
    if (!w) {
      w = createWorksheetTools({ callTool: worksheetMcpCaller({ mcpUrl: url, callTool }) });
      worksheetInstances.set(url, w);
    }
    return w;
  };
  const operations = {
    type: 'array',
    maxItems: 200,
    items: { type: 'object' },
    description: SHEET_OPERATIONS
  };
  return {
    list_block_types: () =>
      tool({
        description:
          'Every block type a worksheet can hold: its type name, its German name, its group (text, task, math, layout, grading) and whether it is a numbered task. Call this first.',
        inputSchema: schema({}, []),
        execute: async () => instance().listBlockTypes()
      }),
    describe_block_types: () =>
      tool({
        description:
          'For each given type: the keys of its data with their shape ("is"), allowed values, whether they are optional and what a new block starts with ("starts": the editor\'s sample, replace every text), and the names of the styles it takes; "styles" then gives the allowed values of each style once. Call this for every type before you use it.',
        inputSchema: schema(
          {
            types: {
              type: 'array',
              minItems: 1,
              maxItems: 20,
              items: { type: 'string' },
              description: 'Type names from list_block_types'
            }
          },
          ['types']
        ),
        execute: async (/** @type {any} */ i) => instance().describeBlockTypes(i?.types)
      }),
    create_sheet: () =>
      tool({
        description:
          'Make a new worksheet from a list of operations and keep it as a draft. Answers with the draft id, the link that opens it in the editor and the outline (one line per block: id, type, start of its text). If the list has a mistake, nothing is made and the answer has "problems" that say what to correct.' +
          '\n\n' +
          SHEET_RULES,
        inputSchema: schema(
          {
            title: {
              type: 'string',
              maxLength: 200,
              description: 'The title of the sheet, e.g. "Hauptstädte Europas"'
            },
            operations
          },
          ['title', 'operations']
        ),
        execute: async (/** @type {any} */ i) => instance().createSheet(i ?? {})
      }),
    change_sheet: () =>
      tool({
        description:
          'Apply a list of operations to an existing draft. Block ids are in the outline that create_sheet answered. Answers like create_sheet; the link stays the same. A copy the teacher already opened in the editor does not change: tell them to open the sheet again.',
        inputSchema: schema(
          {
            draft: { type: 'string', description: 'The draft id from create_sheet' },
            operations
          },
          ['draft', 'operations']
        ),
        execute: async (/** @type {any} */ i) => instance().changeSheet(i ?? {})
      })
  };
}

/** `propose_options`: choices the window renders as an option card (validated, never raw). */
const proposeOptionsTool = () =>
  tool({
    description:
      'Zeigt der Lehrkraft eine Auswahl als Karte (höchstens 8 Optionen mit kurzen Labels); ihre Wahl kommt als nächste Nachricht.',
    inputSchema: schema(
      {
        question: { type: 'string', maxLength: 200 },
        options: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string', maxLength: 80 },
              hint: { type: 'string' }
            },
            required: ['id', 'label']
          }
        },
        multi: { type: 'boolean' }
      },
      ['question', 'options']
    ),
    execute: async (/** @type {any} */ input) =>
      TOOL_REGISTRY.propose_options.toOptions?.(input) ?? { rejected: true }
  });

/** Object schema shared by `parts`' single-slot kinds. */
const titledPart = () => ({
  type: 'object',
  properties: { title: { type: 'string' } },
  additionalProperties: false
});

/** `lesson_state`'s input schema: the `LessonState` patch shape `sanitizeLessonPatch` keeps.
 * No `wrap`/`naddr`/`publication`/`resource` here — those are client-recorded, never model-written. */
const LESSON_STATE_SCHEMA = {
  type: 'object',
  properties: {
    phase: { type: 'integer', minimum: 1, maximum: 7 },
    frame: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        grade: { type: 'string' },
        state: { type: 'string' },
        schoolType: { type: 'string' },
        lessons: { type: 'integer' },
        minutes: { type: 'integer' },
        profile: { type: 'string' },
        topic: { type: 'string' }
      },
      additionalProperties: false
    },
    competences: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        properties: {
          uri: { type: 'string' },
          label: { type: 'string' },
          topic: { type: 'string' }
        },
        required: ['label'],
        additionalProperties: false
      }
    },
    didactics: {
      type: 'object',
      properties: {
        phasing: { type: 'string' },
        methods: { type: 'array', maxItems: 20, items: { type: 'string' } },
        differentiation: { type: 'string' }
      },
      additionalProperties: false
    },
    plan: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          goal: { type: 'string' },
          phases: { type: 'array', items: { type: 'string' } },
          material: { type: 'array', items: { type: 'string' } }
        },
        // rows merge by n (mergeLessonState): a row without it would update the row at its position
        required: ['n'],
        additionalProperties: false
      }
    },
    parts: {
      type: 'object',
      properties: {
        lessons: {
          type: 'array',
          items: {
            type: 'object',
            properties: { n: { type: 'integer' }, title: { type: 'string' } },
            additionalProperties: false
          }
        },
        overview: titledPart(),
        worksheets: titledPart(),
        summary: titledPart(),
        module: titledPart(),
        sources: titledPart()
      },
      additionalProperties: false
    },
    licence: { type: 'string' }
  },
  required: [],
  additionalProperties: false
};

/** `lesson_state`: the model's phase patch, sanitized before it reaches the client. */
const lessonStateTool = () =>
  tool({
    description:
      'Speichert den neuen Stand der Unterrichtsreihe (nur geänderte Felder: phase, frame, competences, didactics, plan, parts, licence). Planzeilen tragen ihr n und werden nach n zusammengeführt; eine Zeile ohne n wird ignoriert, ein Patch kürzt den Plan nie.',
    inputSchema: jsonSchema(/** @type {any} */ (LESSON_STATE_SCHEMA)),
    execute: async (/** @type {any} */ input) => sanitizeLessonPatch(input) ?? { rejected: true }
  });

/**
 * @typedef {{ mcpUrl: string, getToken: () => Promise<string>, callTool?: typeof callNopeMcpTool, memUrl?: string, worksheetUrl?: string, relays?: string[], now?: () => number, tz?: string }} Deps
 *   tz = the user's IANA zone (validated by the route) for search_events from/to;
 *   memUrl = MEM-MCP endpoint, the curriculum tools are left out without it
 *   worksheetUrl = worksheet-mcp endpoint, the worksheet tools are left out without it
 */

/** Knowledge + show_pages tool factories (the nope-mcp client is cheap to make; tools are built on demand). @param {Deps} deps */
function askTools({ mcpUrl, getToken, callTool = callNopeMcpTool, relays, now, tz }) {
  const k = createKnowledgeTools({
    callTool: nopeMcpCaller({ mcpUrl, getToken, callTool }),
    relays,
    now
  });
  // The search reads level, grade and type words itself ("Klasse 7", "Studierende", "Arbeitsblatt")
  // and prefers fitting material: they belong in the query. "nur das Thema" made the model drop them.
  const query = {
    type: 'string',
    description:
      'Suchbegriffe: das Thema, dazu Klassenstufe, Bildungsstufe oder Materialart, wenn die Frage sie nennt (z. B. "Fotosynthese Klasse 7", "Arbeitsblatt Bruchrechnen Grundschule")'
  };

  return {
    search_content: () =>
      knowledgeTool(
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
          },
          community: {
            type: 'string',
            pattern: '^[0-9a-f]{64}$',
            description:
              'Alles in dieser Community (dort geteilt und von ihr selbst gepostet); pubkey (hex) aus find_community. Nicht mit authors kombinieren.'
          },
          lessFitting: {
            type: 'boolean',
            description:
              'true liefert die Treffer, die die Suche als nur lose passend zurückgehalten hat. Nur nach einer leeren Suche und nur, wenn die Person sie sehen möchte.'
          }
        },
        ['query'],
        (i) =>
          k.searchContent(text(i.query), {
            types: Array.isArray(i.types) ? i.types : [],
            authors: i.authors,
            community: i.community,
            lessFitting: i.lessFitting === true
          })
      ),
    get_content: () =>
      knowledgeTool(
        'Holt einen einzelnen Inhalt (Material, Artikel, Wiki …) anhand seiner naddr.',
        { naddr: { type: 'string', maxLength: 600, pattern: '^naddr1[0-9a-z]+$' } },
        ['naddr'],
        (i) => k.getContent(String(i.naddr ?? ''))
      ),
    search_resources: () =>
      knowledgeTool(
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
          const clean = Object.fromEntries(
            Object.entries(filters).map(([key, v]) => [key, text(v)])
          );
          if (!LICENSE_FILTERS.includes(clean.licenseFilter)) delete clean.licenseFilter;
          return k.searchResources(text(q), clean);
        }
      ),
    search_events: () =>
      knowledgeTool(
        'Sucht kommende Veranstaltungen (Fortbildungen, Workshops, Tagungen) im Edufeed-Kalender. Für Fragen mit Zeitbezug (nächste Woche, im Dezember) immer from/to setzen; gefunden werden Veranstaltungen, die in diesem Zeitraum stattfinden.',
        {
          query,
          from: { type: 'string', description: 'Erster Tag, YYYY-MM-DD' },
          to: { type: 'string', description: 'Letzter Tag (einschließlich), YYYY-MM-DD' },
          level: {
            type: 'string',
            description:
              'KIM-Bildungsstufe als URI, z. B. https://w3id.org/kim/educationalLevel/level_C (Fortbildung)'
          }
        },
        ['query'],
        (i) =>
          k.searchEvents(text(i.query), {
            level: text(i.level) || undefined,
            from: text(i.from) || undefined,
            to: text(i.to) || undefined,
            tz
          })
      ),
    search_passages: () =>
      knowledgeTool(
        'Findet Textstellen aus offenen Materialien, die eine Frage beantworten ("wie/was kann ich …"), mit Quelle, Herausgeber und Lizenz.',
        {
          question: { type: 'string' },
          relay: { type: 'string', enum: relays ?? DEFAULT_SEARCH_RELAYS }
        },
        ['question'],
        (i) => k.searchPassages(text(i.question), { relay: text(i.relay) || undefined })
      ),
    find_community: () =>
      knowledgeTool(
        'Findet Communities im Edufeed-Netzwerk zu einem Thema ("welche Community …").',
        { query },
        ['query'],
        (i) => k.findCommunity(text(i.query))
      ),
    find_people: () =>
      knowledgeTool(
        'Findet Personen oder Organisationen im Nostr-Netzwerk nach Namen.',
        { name: { type: 'string' } },
        ['name'],
        (i) => k.findPeople(text(i.name))
      ),
    show_pages: () => showPagesTool()
  };
}

/**
 * @param {string} task a `TERMI_TASKS` key
 * @param {Deps} deps
 */
export function buildTermiTools(task, deps) {
  if (!Object.hasOwn(TERMI_TASKS, task)) throw new Error(`unknown Termi task: ${task}`);
  /** @type {Record<string, () => any>} */
  const factories = {
    ...askTools(deps),
    ...(deps.memUrl ? curriculumTools(deps) : {}),
    ...(deps.worksheetUrl ? worksheetTools(deps) : {}),
    propose_options: proposeOptionsTool,
    lesson_state: lessonStateTool
  };
  const names = TERMI_TASKS[/** @type {keyof typeof TERMI_TASKS} */ (task)].tools;
  return Object.fromEntries(names.filter((n) => factories[n]).map((n) => [n, factories[n]()]));
}
