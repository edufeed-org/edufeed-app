/**
 * The Termi tool registry: one entry per tool `buildTermiTools('ask')` builds
 * (a drift test keeps the key sets equal). Isomorphic — the server, the chat
 * window, the history codec and the eval script all read it, so: plain ESM,
 * no `$lib/server`, Svelte or Paraglide imports.
 *
 * Per tool: `kind` (knowledge = `{ items, sourcesUnavailable }` output shown as
 * cards; action = anything else), `persist(output)` (what history keeps),
 * `promptHint` (its routing sentence in the `ask` prompt) and, for tools whose
 * items may lack a `type`, `defaultItemType`.
 */

/** @typedef {import('./items.d.js').SlimItem} SlimItem */
/**
 * @typedef {{ kind: 'knowledge'|'action', persist: (output: any) => object|null,
 *   promptHint: string, defaultItemType?: string }} ToolEntry
 */

/** @param {Record<string, unknown>} o */
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** `/path` or http(s) only — restored content never went through the server's safeUrl. @param {unknown} u */
const safeHref = (u) =>
  typeof u === 'string' && ((u.startsWith('/') && !u.startsWith('//')) || /^https?:\/\//i.test(u))
    ? u
    : undefined;
/** @param {unknown} v */
const str = (v) => (typeof v === 'string' && v ? v : undefined);
/** @param {unknown} u */
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : undefined);
/** @param {unknown} v @returns {string[]} */
export const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []);

/** Item (server shape, `date`) or SlimItem (`start`) → SlimItem. @param {any} it @returns {SlimItem} */
export function slimItem(it) {
  return /** @type {SlimItem} */ (
    compact({
      type: String(it?.type ?? ''),
      id: String(it?.id ?? ''),
      title: String(it?.title ?? ''),
      href: safeHref(it?.href),
      pubkey: typeof it?.pubkey === 'string' ? it.pubkey : undefined,
      picture: safeHref(it?.picture),
      start: typeof (it?.start ?? it?.date) === 'string' ? (it.start ?? it.date) : undefined,
      end: typeof it?.end === 'string' ? it.end : undefined,
      location: typeof it?.location === 'string' ? it.location : undefined,
      // attribution, for a restored document's sources section
      creator: str(it?.creator),
      publisher: str(it?.publisher),
      license: str(it?.license),
      licenseUrl: httpUrl(it?.licenseUrl),
      sourceUrl: httpUrl(it?.sourceUrl)
    })
  );
}

/** A knowledge tool's `{ items, sourcesUnavailable }` → its history form. @param {any} output */
export const persistItems = (output) => ({
  items: Array.isArray(output?.items) ? output.items.map(slimItem) : [],
  sourcesUnavailable: strings(output?.sourcesUnavailable)
});

const MATERIALS_HINT =
  'Fragen nach Materialien, Angeboten oder Beispielen (was gibt es, welche Materialien): nutze search_content oder search_resources.';

/** @type {Record<string, ToolEntry>} */
export const TOOL_REGISTRY = {
  search_content: { kind: 'knowledge', persist: persistItems, promptHint: MATERIALS_HINT },
  search_resources: { kind: 'knowledge', persist: persistItems, promptHint: MATERIALS_HINT },
  search_events: {
    kind: 'knowledge',
    persist: persistItems,
    defaultItemType: 'event',
    promptHint:
      'Veranstaltungen suchst du mit search_events. Bei Zeitangaben berechne das Datumsfenster aus dem heutigen Datum und übergib es als from/to an search_events; antworte nie, dass du das Datum nicht kennst.'
  },
  search_passages: {
    kind: 'knowledge',
    persist: persistItems,
    defaultItemType: 'passage',
    promptHint:
      'Fragen danach, WIE etwas geht oder WARUM (wie, warum, was kann ich tun, was hilft): nutze search_passages und nenne im Satz Titel, Herausgeber und Lizenz der Quelle. Rufe höchstens zweimal search_passages pro Antwort auf (außer für ein Dokument, siehe nächste Regel).'
  },
  find_community: {
    kind: 'knowledge',
    persist: persistItems,
    defaultItemType: 'community',
    promptHint:
      'Fragen mit „welche Community …“: nutze find_community und nenne die Community (oder Communities) im Satz.'
  },
  find_people: {
    kind: 'knowledge',
    persist: persistItems,
    defaultItemType: 'person',
    promptHint: 'Fragen mit „wer …“: nutze find_people und nenne die Personen aus den Ergebnissen.'
  },
  // toActions (ids → skill buttons) stays in the window until the answer-action contract.
  show_pages: {
    kind: 'action',
    persist: (output) => ({ ids: strings(output?.ids) }),
    promptHint:
      "Fragen nach den eigenen Nachrichten, Terminen, Lesezeichen, Einstellungen, dem eigenen Profil oder danach, wo etwas in der App ist, beantwortest du mit show_pages (höchstens zwei ids) — ein kurzer Satz davor ist erlaubt. Antworte nie mit 'ich habe keinen Zugriff'."
  }
};

/** A UI tool part's tool name: `tool-<name>` or `dynamic-tool` with `toolName`. @param {any} part */
export const toolNameOf = (part) =>
  part?.type === 'dynamic-tool' ? part.toolName : part?.type?.replace(/^tool-/, '');

/** @param {unknown} name */
export const isKnowledgeTool = (name) =>
  typeof name === 'string' &&
  Object.hasOwn(TOOL_REGISTRY, name) &&
  TOOL_REGISTRY[name].kind === 'knowledge';

export const knowledgeToolNames = () => Object.keys(TOOL_REGISTRY).filter(isKnowledgeTool);
