/**
 * The Termi tool registry: one entry per tool any `TERMI_TASKS` task builds
 * (a drift test keeps the key sets equal per task; `optional` entries may be
 * absent, e.g. the MEM tools with `MEM_MCP_URL=none`). Isomorphic — the server, the chat
 * window, the history codec and the eval script all read it, so: plain ESM,
 * no `$lib/server`, Svelte or Paraglide imports.
 *
 * Per tool: `kind` (knowledge = `{ items, sourcesUnavailable }` output shown as
 * cards; action = anything else), `persist(output)` (what history keeps),
 * `promptHint` (its routing sentence in the prompt of every task that lists it), for tools whose
 * items may lack a `type`, `defaultItemType`, and for action tools
 * `toActions(output, ctx)` (the buttons under the answer) or `toOptions(output)`
 * (an option card the user picks from).
 */

/** @typedef {import('./items.d.js').SlimItem} SlimItem */
/**
 * What `toActions` needs from the app — passed in, so this file stays free of
 * Svelte, Paraglide and the router (`skillById`/`skillAction` live in termi-router.js).
 * @typedef {{ label: string, href?: string, target?: string, rel?: string, run?: () => void }} ToolAction
 * @typedef {{
 *   npub: string | null,
 *   runCreate: (action: any) => void,
 *   runHelp: (skill: any) => void,
 *   skillById: (id: string) => any,
 *   skillAction: (skill: any, ctx: { npub: string | null, runCreate: (action: any) => void, runHelp: (skill: any) => void }) => ToolAction | null,
 *   send?: (text: string) => void
 * }} ToolActionCtx
 * @typedef {{ question: string, options: { id: string, label: string, hint?: string }[], multi: boolean }} OptionsCard
 * @typedef {{ kind: 'knowledge'|'action', persist: (output: any) => object|null,
 *   promptHint: string, defaultItemType?: string, optional?: boolean,
 *   toActions?: (output: any, ctx: ToolActionCtx) => ToolAction[],
 *   toOptions?: (output: any) => OptionsCard | null }} ToolEntry
 */
import { sanitizeLessonPatch } from './lesson-state.js';

/** @param {Record<string, unknown>} o */
export const compact = (o) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

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

/** @param {unknown} v @param {number} max */
const capped = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * Model-written options → a card the window can key by id: deduped by id,
 * ≤ 8, label ≤ 80, hint ≤ 200, question ≤ 200; null without a usable option.
 * @param {any} output @returns {OptionsCard | null}
 */
function toOptions(output) {
  const seen = new Set();
  const options = [];
  for (const o of Array.isArray(output?.options) ? output.options : []) {
    const id = capped(o?.id, 64);
    const label = capped(o?.label, 80);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    options.push(
      /** @type {OptionsCard['options'][number]} */ (
        compact({ id, label, hint: capped(o?.hint, 200) })
      )
    );
    if (options.length === 8) break;
  }
  if (!options.length) return null;
  return { question: capped(output?.question, 200) ?? '', options, multi: output?.multi === true };
}

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
  show_pages: {
    kind: 'action',
    persist: (output) => ({ ids: strings(output?.ids) }),
    // the one place page ids become buttons (live answers and restored ones); a profile page needs a login
    toActions: (output, ctx) =>
      /** @type {ToolAction[]} */ (
        strings(output?.ids)
          .map((id) => ctx.skillById(id))
          .filter((s) => s && (!s.requiresUser || ctx.npub))
          .map((s) => ctx.skillAction(s, ctx))
          .filter(Boolean)
      ),
    promptHint:
      "Fragen nach den eigenen Nachrichten, Terminen, Lesezeichen, Einstellungen, dem eigenen Profil oder danach, wo etwas in der App ist, beantwortest du mit show_pages (höchstens zwei ids) — ein kurzer Satz davor ist erlaubt. Antworte nie mit 'ich habe keinen Zugriff'."
  },
  find_curriculum: {
    kind: 'knowledge',
    optional: true,
    // `id` is a composite filter string, not a citable URI: kept for curriculum_competences only
    persist: (output) => ({
      curricula: (Array.isArray(output?.curricula) ? output.curricula : []).map(
        (/** @type {any} */ c) =>
          compact({
            id: str(c?.id),
            title: str(c?.title),
            state: str(c?.state),
            schoolType: str(c?.schoolType),
            subject: str(c?.subject),
            grades: strings(c?.grades)
          })
      )
    }),
    promptHint:
      'Den Lehrplan suchst du mit find_curriculum (Bundesland, Schulart, Fach, Jahrgangsstufe). Gib die id des passenden Lehrplans unverändert als curriculumId an curriculum_competences weiter; die id zeigst du nie.'
  },
  curriculum_competences: {
    kind: 'knowledge',
    optional: true,
    persist: (output) => ({
      competences: (Array.isArray(output?.competences) ? output.competences : [])
        .filter((/** @type {any} */ c) => httpUrl(c?.uri) && str(c?.label))
        .map((/** @type {any} */ c) =>
          compact({ uri: c.uri, label: c.label, topic: str(c?.topic) })
        )
    }),
    promptHint:
      'Kompetenzen nennst du nur aus curriculum_competences. Liefert es keine, sag das offen und frag die Lehrkraft nach ihren Lernzielen — erfinde keine Kompetenzen.'
  },
  propose_options: {
    kind: 'action',
    persist: (output) => toOptions(output),
    toOptions,
    promptHint:
      'Wenn die Lehrkraft zwischen wenigen Möglichkeiten wählen soll (Bundesland, Kompetenzen, Methoden, Materialauswahl), nutze propose_options mit kurzen Labels statt einer Liste im Text; multi: true nur, wenn mehrere zugleich gelten können.'
  },
  lesson_state: {
    kind: 'action',
    persist: (patch) => sanitizeLessonPatch(patch),
    promptHint:
      'Am Ende jeder Phase, sobald die Lehrkraft bestätigt hat, schreibst du den neuen Stand mit lesson_state (nur die geänderten Felder, phase = die nächste Phase).'
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

/** Every action tool's buttons for these (finished) UI tool parts, in part order. @param {any[]} parts @param {ToolActionCtx} ctx */
export const toolActions = (parts, ctx) =>
  parts.flatMap((p) => {
    const name = toolNameOf(p);
    return (
      (Object.hasOwn(TOOL_REGISTRY, name) && TOOL_REGISTRY[name].toActions?.(p.output, ctx)) || []
    );
  });

/** The option card of the last finished propose_options part, or null. @param {any[]} parts @returns {OptionsCard | null} */
export const toolOptions = (parts) => {
  const part = parts.findLast(
    (p) => toolNameOf(p) === 'propose_options' && p.state === 'output-available'
  );
  return part ? toOptions(part.output) : null;
};
