/**
 * Curriculum cascade endpoint.
 *
 * Thin proxy over the publicly reachable Lehrplan ontology Virtuoso
 * (`SPARQL_ENDPOINT_URL`). The CurriculumPicker drives a five-level cascade
 * (Bundesland → Schulart → Schulfach → Lehrplan → topic node) by POSTing
 * { tool, args } here. We translate the chosen tool into a SPARQL 1.1 query
 * with the user's URIs substituted in, run it via `sparqlClient.query`,
 * and shape the resulting bindings into the picker's typed JSON.
 *
 * Cached for 24h since curriculum data changes rarely.
 *
 * Tool name is whitelisted to keep raw SPARQL out of the browser, and every
 * URI argument is validated as a real http(s) URL containing none of
 * `< > " \ whitespace` — so user-supplied values cannot break out of the
 * `<URI>` slots in the templates below.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { query } from '$lib/server/sparqlClient.js';

const CACHE_HEADER = 'public, max-age=86400';

const PREFIXES = `PREFIX lp: <https://w3id.org/lehrplan/ontology/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>`;

/**
 * Reject anything that isn't a plain http(s) URL or that contains characters
 * which would break out of the `<URI>` slot in our SPARQL templates.
 *
 * @param {unknown} val
 * @returns {string | null} The validated URI, or null if invalid.
 */
function validateUri(val) {
  if (typeof val !== 'string') return null;
  if (/[<>"\\\s]/.test(val)) return null;
  try {
    const u = new URL(val);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return val;
  } catch {
    return null;
  }
}

/**
 * Build the SPARQL query for a tool, substituting URIs.
 * Returns null if any required arg is missing or invalid.
 *
 * @param {string} tool
 * @param {Record<string, unknown>} args
 * @returns {string | null}
 */
function buildSparql(tool, args) {
  switch (tool) {
    case 'list_bundeslaender':
      return `${PREFIXES}
SELECT DISTINCT ?uri ?label WHERE {
  ?s lp:LP_0000029 ?uri .
  ?uri rdfs:label ?label .
  FILTER(lang(?label) = "de")
} ORDER BY ?label`;

    case 'list_schularten': {
      const bl = validateUri(args.bundeslandUri);
      if (!bl) return null;
      return `${PREFIXES}
SELECT DISTINCT ?uri (SAMPLE(?l) AS ?label) WHERE {
  ?s lp:LP_0000812 ?uri .
  ?uri rdfs:label ?l .
  ?s lp:LP_0000029 <${bl}> .
} GROUP BY ?uri ORDER BY ?label`;
    }

    case 'list_schulfaecher': {
      const bl = validateUri(args.bundeslandUri);
      const sa = validateUri(args.schulartUri);
      if (!bl || !sa) return null;
      return `${PREFIXES}
SELECT DISTINCT ?uri (SAMPLE(?l) AS ?label) WHERE {
  ?s lp:LP_0000537 ?uri .
  ?uri rdfs:label ?l .
  ?s lp:LP_0000029 <${bl}> .
  ?s lp:LP_0000812 <${sa}> .
  FILTER(lang(?l) = "de")
} GROUP BY ?uri ORDER BY ?label`;
    }

    case 'find_lehrplaene': {
      const bl = validateUri(args.bundeslandUri);
      const sa = validateUri(args.schulartUri);
      const sf = validateUri(args.schulfachUri);
      if (!bl || !sa || !sf) return null;
      return `${PREFIXES}
SELECT DISTINCT ?s ?label WHERE {
  ?lpsubclass rdfs:subClassOf* lp:LP_0000438 .
  ?s rdf:type ?lpsubclass .
  ?s rdfs:label ?label .
  ?s lp:LP_0000029 <${bl}> .
  ?s lp:LP_0000537 <${sf}> .
  ?s lp:LP_0000812 <${sa}> .
} ORDER BY ?label LIMIT 50`;
    }

    case 'get_lehrplan_tree': {
      const lp = validateUri(args.lehrplanUri);
      if (!lp) return null;
      return `${PREFIXES}
SELECT DISTINCT ?parent ?parentLabel ?child ?childLabel WHERE {
  { BIND(<${lp}> AS ?parent) . ?parent lp:LP_0000008 ?child . }
  UNION
  { <${lp}> lp:LP_0000008 ?step1 . ?step1 lp:LP_0000008 ?child . BIND(?step1 AS ?parent) }
  OPTIONAL { ?parent rdfs:label ?parentLabel . }
  OPTIONAL { ?child rdfs:label ?childLabel . }
} ORDER BY ?parent ?child`;
    }

    case 'get_node_children': {
      const node = validateUri(args.nodeUri);
      if (!node) return null;
      // Labels in this dataset are mostly untagged (lang === ""). A language
      // filter would silently drop them, so we accept any label and dedupe in
      // the response shaping step.
      // The `hasChildren` flag (EXISTS-subquery) lets the picker decide
      // up-front whether to render an expand chevron or a leaf glyph,
      // avoiding the "click chevron only to learn it's a leaf" UX trap.
      return `${PREFIXES}
SELECT DISTINCT ?child ?childLabel (EXISTS { ?child lp:LP_0000008 ?gc } AS ?hasChildren) WHERE {
  <${node}> lp:LP_0000008 ?child .
  OPTIONAL { ?child rdfs:label ?childLabel . }
} ORDER BY ?childLabel`;
    }

    default:
      return null;
  }
}

/** Tools the picker may invoke. Anything else is rejected. */
const ALLOWED_TOOLS = new Set([
  'list_bundeslaender',
  'list_schularten',
  'list_schulfaecher',
  'find_lehrplaene',
  'get_lehrplan_tree',
  'get_node_children'
]);

/**
 * Convert SPARQL bindings of shape `{ <key>: { value }, label: { value } }`
 * to picker items. Accepts either `uri` or `s` as the id column (mirrors
 * mem-mcp's two SELECT shapes). When the binding carries a `hasChildren`
 * column (only `get_node_children` does), it's surfaced as a boolean.
 *
 * @param {Record<string, { value: string, datatype?: string }>[]} bindings
 * @returns {{ id: string, label: string, hasChildren?: boolean }[]}
 */
function bindingsToItems(bindings) {
  /** @type {{ id: string, label: string, hasChildren?: boolean }[]} */
  const out = [];
  for (const b of bindings) {
    const id = b.uri?.value ?? b.s?.value ?? b.child?.value ?? '';
    const label = b.label?.value ?? b.childLabel?.value ?? '';
    if (!id || !label) continue;
    /** @type {{ id: string, label: string, hasChildren?: boolean }} */
    const item = { id, label };
    // Virtuoso returns EXISTS as xsd:integer "1"/"0"; SPARQL stores
    // typically return xsd:boolean "true"/"false". Accept both.
    if (b.hasChildren) {
      const v = b.hasChildren.value;
      item.hasChildren = v === 'true' || v === '1';
    }
    out.push(item);
  }
  return out;
}

/**
 * Convert tree-edge bindings to a deduped node list with parentId.
 * Top-level categories (whose parent is the Lehrplan URI itself) get
 * `parentId: null` so the picker can treat the Lehrplan as an implicit root.
 *
 * @param {Record<string, { value: string }>[]} bindings
 * @param {string} lehrplanUri
 * @returns {{ id: string, label: string, parentId: string | null }[]}
 */
function bindingsToTreeNodes(bindings, lehrplanUri) {
  /** @type {Map<string, { id: string, label: string, parentId: string | null }>} */
  const byId = new Map();
  for (const b of bindings) {
    const childId = b.child?.value;
    const childLabel = b.childLabel?.value;
    const parentId = b.parent?.value;
    if (!childId || !childLabel) continue;
    const normalizedParent = parentId === lehrplanUri ? null : parentId || null;
    if (!byId.has(childId)) {
      byId.set(childId, { id: childId, label: childLabel, parentId: normalizedParent });
    }
  }
  return [...byId.values()];
}

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function POST({ request }) {
  /** @type {{ tool?: string, args?: Record<string, unknown> }} */
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const tool = typeof body.tool === 'string' ? body.tool : '';
  if (!ALLOWED_TOOLS.has(tool)) {
    return json({ error: `Unknown tool '${tool}'` }, { status: 400 });
  }

  const args = body.args && typeof body.args === 'object' ? body.args : {};

  const endpoint = env.SPARQL_ENDPOINT_URL;
  if (!endpoint) {
    console.error('[/api/curricula] SPARQL_ENDPOINT_URL is not configured');
    return json({ error: 'Curriculum service not configured' }, { status: 503 });
  }

  const sparql = buildSparql(tool, args);
  if (!sparql) {
    return json({ error: `Invalid or missing arguments for '${tool}'` }, { status: 400 });
  }

  let result;
  try {
    result = await query({ endpoint, sparql });
  } catch (err) {
    console.error(`[/api/curricula] ${tool} SPARQL query failed:`, err);
    return json({ error: 'Upstream SPARQL error' }, { status: 502 });
  }

  const bindings = result?.results?.bindings ?? [];

  /** @type {object} */
  let payload;
  if (tool === 'get_lehrplan_tree') {
    const lehrplanUri = validateUri(args.lehrplanUri) ?? '';
    payload = { nodes: bindingsToTreeNodes(bindings, lehrplanUri) };
  } else {
    payload = { items: bindingsToItems(bindings) };
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': CACHE_HEADER
    }
  });
}
