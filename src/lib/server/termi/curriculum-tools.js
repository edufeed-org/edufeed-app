/**
 * MEM-MCP curriculum tools for the Termi `lesson` task: resolve a
 * Bundesland/Schulart/Schulfach/Jahrgangsstufe combination to curricula
 * (`find_lehrplaene`), then read a curriculum's competences
 * (`get_kompetenzen`). Server-side only — talks to MEM-MCP over the same
 * streamable-HTTP MCP client used for nope-mcp (`nopeMcpClient.js`).
 *
 * Probed live against `https://mcp.mem.edufeed.org/mcp` on 2026-11-10
 * (tools/list + a handful of calls; see `.superpowers/sdd/2026-11-10-termi-lesson-series/task-1-report.md`
 * for the full session). Findings that shape this file:
 *
 * - Exact tool names/args (from `tools/list`'s `inputSchema`):
 *   `list_bundeslaender()`, `list_schularten({ bundesland })`,
 *   `list_schulfaecher({ bundesland })`,
 *   `find_lehrplaene({ bundesland, schulart?, schulfach?, jahrgangsstufe? })`,
 *   `get_kompetenzen({ bundesland, schulart?, schulfach?, jahrgangsstufe? })`
 *   — NOTE: `get_kompetenzen` filters by state/type/subject/grade directly,
 *   it does **not** take a Lehrplan id/URI. `get_lehrplan_tree({ lehrplanUri, depth? })`
 *   and `get_children({ nodeUri })` walk a Lehrplan's structure; `search({ query, bundesland?, schulfach? })`
 *   is full-text. `bundesland` accepts a state code (BY, SN, RP, ...) or the
 *   exact name from `list_bundeslaender` — "NRW" and "nordrhein westfalen"
 *   (lowercase/no hyphen) were both rejected live, so this file resolves a
 *   teacher's free-text name against `list_bundeslaender`'s labels itself
 *   (case/diacritic/whitespace-insensitive) before calling MEM, and falls
 *   back to the raw input (works for a bare code) when nothing matches.
 *   `schulart`/`schulfach` are resolved the same way against
 *   `list_schularten`/`list_schulfaecher` for that Bundesland.
 * - Every MEM-MCP tool returns a markdown-ish pipe table
 *   (`"uri | label\n---\n<uri> | <label>\n..."`) or a plain sentence
 *   ("No results.", "Unknown Bundesland: ...", "No Kompetenzen found...")
 *   as `content[0].text` — **never JSON, never `structuredContent`**.
 *   `callNopeMcpTool` (`nopeMcpClient.js`) always `JSON.parse`s that text by
 *   default, which would throw a `SyntaxError` on every *successful*
 *   MEM-MCP call — so `callNopeMcpTool` now takes a `raw: true` option that
 *   returns the text untouched instead (`isError` handling is unchanged;
 *   that path already threw a usable error before reaching the JSON/raw
 *   branch). `memMcpCaller`, below, wires that up: wire a Lehrplan tool
 *   call with
 *   `createCurriculumTools({ callTool: memMcpCaller({ mcpUrl: memMcpEnv(env).mcpUrl, getToken: getNopeMcpToken }) })`
 *   (`getNopeMcpToken` from `$lib/server/nopeMcpToken.js` — MEM-MCP validates
 *   the same Keycloak token as nope-mcp, reads are public so it's only
 *   fetched on a 401).
 * - As of 2026-11-10, MEM-MCP has top-level Lehrplan metadata for Bayern,
 *   Sachsen and Rheinland-Pfalz (others answered "No results."/empty), but
 *   `get_kompetenzen`, `get_lehrplan_tree` and `get_children` returned empty
 *   for every Bundesland/Schulart/Schulfach combination probed — the
 *   Kompetenz/tree data isn't loaded into the triple store yet. This is
 *   exactly the plan's Review Focus #1 case (MEM answers nothing) and is
 *   why the `get_kompetenzen` fixture here is a synthetic example (clearly
 *   marked) rather than a captured response.
 *
 * @typedef {{ id: string, title: string, state: string, schoolType: string, subject: string, grades: string[], topics: { id: string, label: string }[] }} Curriculum
 * @typedef {{ uri: string, label: string, topic?: string }} Competence
 */

import { compact } from '../../termi/tool-registry.js';
import { callNopeMcpTool } from '../nopeMcpClient.js';

const MAX_CURRICULA = 5;
const MAX_COMPETENCES = 12;
const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MEM_MCP_URL = 'https://mcp.mem.edufeed.org/mcp';

/** `MEM_MCP_URL` env, falling back to the deployed default. @param {Record<string, string | undefined>} env */
export function memMcpEnv(env) {
  return { mcpUrl: (env && env.MEM_MCP_URL) || DEFAULT_MEM_MCP_URL };
}

/**
 * `(name, args) => Promise<string>` over MEM-MCP: anonymous first, a
 * client-credentials token only on a 401 — same contract as
 * `nopeMcpCaller` (`knowledge-tools.js`), but always calls with `raw: true`
 * since MEM-MCP's tools answer in plain text, never JSON.
 * @param {{ mcpUrl: string, getToken: () => Promise<string>, callTool?: typeof callNopeMcpTool }} deps
 */
export function memMcpCaller({ mcpUrl, getToken, callTool = callNopeMcpTool }) {
  return async (/** @type {string} */ name, /** @type {object} */ args) => {
    try {
      return await callTool({ mcpUrl, bearerToken: undefined, name, args, raw: true });
    } catch (err) {
      if (/** @type {any} */ (err)?.status !== 401) throw err;
      return callTool({ mcpUrl, bearerToken: await getToken(), name, args, raw: true });
    }
  };
}

/** Lowercase, strip diacritics and anything that isn't a letter/digit, for name matching. @param {unknown} s */
function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * A MEM-MCP tool's raw text result's pipe-table rows (`[uri, label]`
 * pairs), or `[]` for a plain-sentence result ("No results.") or anything
 * that isn't a string (`safeCall` returns `undefined` on a thrown call —
 * including a tool error like "Unknown Bundesland: ...", which
 * `callNopeMcpTool` already throws for, `raw` or not).
 * @param {unknown} text
 * @returns {[string, string][]}
 */
function parseRows(text) {
  if (typeof text !== 'string') return [];
  const lines = text.split('\n');
  const sep = lines.findIndex((l) => l.trim() === '---');
  if (sep === -1) return [];
  return lines
    .slice(sep + 1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('|');
      return i === -1 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    });
}

/** A trailing grade or grade range in a Lehrplan title ("Mathematik 1-4" → ['1','2','3','4']). @param {string} title */
function gradesFromTitle(title) {
  const m = /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*$/.exec(title) || /(\d{1,2})\s*$/.exec(title);
  if (!m) return [];
  const start = Number(m[1]);
  const end = m[2] !== undefined ? Number(m[2]) : start;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end - start > 13) {
    return [];
  }
  const grades = [];
  for (let g = start; g <= end; g++) grades.push(String(g));
  return grades;
}

/** `jahrgangsstufe` MEM accepts: an integer 1-13, else undefined. @param {unknown} grade */
function toGrade(grade) {
  const n = Number(grade);
  return Number.isInteger(n) && n >= 1 && n <= 13 ? n : undefined;
}

/**
 * @param {(name: string, args: Record<string, any>) => Promise<string>} callTool
 * @param {string} name
 * @param {Record<string, any>} args
 * @param {Set<string>} unavailable - a thrown call adds `'mem'`; a clean "no results" does not.
 */
async function safeCall(callTool, name, args, unavailable) {
  try {
    return await callTool(name, args);
  } catch {
    unavailable.add('mem');
    return undefined;
  }
}

/**
 * Resolve a teacher's free-text name against a list's labels
 * (case/diacritic/whitespace-insensitive); falls back to the raw input
 * (so a bare MEM code like "BY" still passes through).
 * @param {{ label: string }[]} list
 * @param {unknown} input
 */
function resolveLabel(list, input) {
  if (typeof input !== 'string' || !input.trim()) return undefined;
  const match = list.find((x) => normalize(x.label) === normalize(input));
  return match ? match.label : input.trim();
}

/**
 * @param {{ callTool: (name: string, args: Record<string, any>) => Promise<string> }} deps
 *   `callTool` must resolve to the MEM-MCP tool's raw text result (the
 *   pipe table or sentence, not JSON-parsed) — `memMcpCaller`, above, is
 *   the one in normal use.
 */
export function createCurriculumTools({ callTool }) {
  /** @type {Map<string, { value: any, expiresAt: number }>} */
  const cache = new Map();

  /** @param {string} key @param {() => Promise<any>} fetcher */
  async function cached(key, fetcher) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await fetcher();
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  /** @param {Set<string>} unavailable */
  const listBundeslaender = (unavailable) =>
    cached('bundeslaender', async () => {
      const result = await safeCall(callTool, 'list_bundeslaender', {}, unavailable);
      return parseRows(result).map(([uri, label]) => ({ uri, label }));
    });

  /** @param {string} bundesland @param {Set<string>} unavailable */
  const listSchularten = (bundesland, unavailable) =>
    cached(`schularten:${bundesland}`, async () => {
      const result = await safeCall(callTool, 'list_schularten', { bundesland }, unavailable);
      return parseRows(result).map(([uri, label]) => ({ uri, label }));
    });

  /** @param {string} bundesland @param {Set<string>} unavailable */
  const listSchulfaecher = (bundesland, unavailable) =>
    cached(`schulfaecher:${bundesland}`, async () => {
      const result = await safeCall(callTool, 'list_schulfaecher', { bundesland }, unavailable);
      return parseRows(result).map(([uri, label]) => ({ uri, label }));
    });

  /**
   * @param {{ state?: string, schoolType?: string, subject?: string, grade?: string|number }} q
   * @returns {Promise<{ curricula: Curriculum[], sourcesUnavailable: string[] }>}
   */
  async function findCurriculum({ state, schoolType, subject, grade } = {}) {
    const unavailable = new Set();
    const bundeslaender = await listBundeslaender(unavailable);
    const bundesland = resolveLabel(bundeslaender, state);
    if (!bundesland) return { curricula: [], sourcesUnavailable: [...unavailable] };

    const [schularten, schulfaecher] = await Promise.all([
      listSchularten(bundesland, unavailable),
      listSchulfaecher(bundesland, unavailable)
    ]);
    const schulart = schoolType ? resolveLabel(schularten, schoolType) : undefined;
    const schulfach = subject ? resolveLabel(schulfaecher, subject) : undefined;

    const args = compact({ bundesland, schulart, schulfach, jahrgangsstufe: toGrade(grade) });
    const result = await safeCall(callTool, 'find_lehrplaene', args, unavailable);
    const rows = parseRows(result).slice(0, MAX_CURRICULA);

    const curricula = rows.map(([uri, label]) => ({
      // `id` carries the filters get_kompetenzen needs (it takes no Lehrplan
      // id of its own, see the file comment) alongside the Lehrplan URI.
      id: [bundesland, schulart ?? '', schulfach ?? '', uri].join('|'),
      title: label,
      state: bundesland,
      schoolType: schulart ?? '',
      subject: schulfach ?? '',
      grades: gradesFromTitle(label),
      // shortcut: MEM has no populated Lehrplan tree yet (get_lehrplan_tree
      // and get_children returned empty for every curriculum probed live,
      // 2026-11-10) — revisit once it does, by calling get_lehrplan_tree
      // per curriculum instead of always [].
      topics: []
    }));

    return { curricula, sourcesUnavailable: [...unavailable] };
  }

  /**
   * @param {{ curriculumId?: string, topicId?: string, grade?: string|number, query?: string }} q
   *   `topicId`/`query` are accepted for interface compatibility but unused:
   *   `get_kompetenzen` has no per-topic or free-text filter.
   * @returns {Promise<{ competences: Competence[], sourcesUnavailable: string[] }>}
   */
  async function curriculumCompetences({ curriculumId, grade } = {}) {
    const unavailable = new Set();
    const [bundesland, schulart, schulfach] = String(curriculumId ?? '').split('|');
    if (!bundesland) return { competences: [], sourcesUnavailable: [] };

    const args = compact({
      bundesland,
      schulart: schulart || undefined,
      schulfach: schulfach || undefined,
      jahrgangsstufe: toGrade(grade)
    });
    const result = await safeCall(callTool, 'get_kompetenzen', args, unavailable);
    const competences = parseRows(result)
      .filter(([uri]) => /^https?:\/\//i.test(uri))
      .slice(0, MAX_COMPETENCES)
      .map(([uri, label]) => ({ uri, label }));

    return { competences, sourcesUnavailable: [...unavailable] };
  }

  return { findCurriculum, curriculumCompetences };
}
