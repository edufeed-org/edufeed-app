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
import { validateSparqlIri } from '$lib/server/httpUrl.js';

const CACHE_HEADER = 'public, max-age=86400';

const PREFIXES = `PREFIX lp: <https://w3id.org/lehrplan/ontology/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX obo: <http://purl.obolibrary.org/obo/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>`;

/**
 * Resolve the optional Schulart filter clause used by list_schulfaecher and
 * find_lehrplaene. The frontend's "Alle Schularten" sentinel omits the arg,
 * which must drop the LP_0000812 filter so Lehrpläne that don't declare a
 * Schulart (common in RP, SN, …) still surface.
 *
 * - undefined / ''          → `{filter: ''}`     (omit clause)
 * - valid http(s) IRI       → `{filter: ' …'}`   (add LP_0000812 clause)
 * - non-empty invalid IRI   → `null`              (caller should return 400)
 *
 * @param {unknown} rawSchulartUri
 * @returns {{ filter: string } | null}
 */
function resolveOptionalSchulartFilter(rawSchulartUri) {
  if (rawSchulartUri == null || rawSchulartUri === '') return { filter: '' };
  const sa = validateSparqlIri(rawSchulartUri);
  if (!sa) return null;
  return { filter: `\n  ?s lp:LP_0000812 <${sa}> .` };
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
      // Query the Bundesland class (LP_0000040 "Bundesland Bezeichnung")
      // directly instead of reverse-scanning lp:LP_0000029 — every node in
      // every state graph carries that predicate, so the reverse scan walks
      // ~1.6M triples to find 16 distinct objects. The class has 16 typed
      // instances, full stop.
      //
      // Only 4 of those 16 states actually carry curriculum data (BY, SN, RP,
      // BE); the other 12 are typed but empty, and picking them yields a dead
      // cascade. Gate on the existence of a Schulfach-bearing Lehrplan
      // (lp:LP_0000537 is a Lehrplan-level predicate) so only states with data
      // are selectable. The FILTER EXISTS is scoped to the already-bound ?uri,
      // so it stays cheap — a bare `?lp lp:LP_0000029 ?uri` still returns all
      // 16 because every state is referenced by some node.
      return `${PREFIXES}
SELECT DISTINCT ?uri ?label WHERE {
  ?uri a lp:LP_0000040 ;
       rdfs:label ?label .
  FILTER(lang(?label) = "de")
  FILTER EXISTS { ?lp lp:LP_0000029 ?uri ; lp:LP_0000537 [] }
} ORDER BY ?label`;

    case 'list_schularten': {
      const bl = validateSparqlIri(args.bundeslandUri);
      if (!bl) return null;
      return `${PREFIXES}
SELECT DISTINCT ?uri (SAMPLE(?l) AS ?label) WHERE {
  ?s lp:LP_0000812 ?uri .
  ?uri rdfs:label ?l .
  ?s lp:LP_0000029 <${bl}> .
  FILTER(lang(?l) = "de")
} GROUP BY ?uri ORDER BY ?label`;
    }

    case 'list_schulfaecher': {
      const bl = validateSparqlIri(args.bundeslandUri);
      if (!bl) return null;
      const sa = resolveOptionalSchulartFilter(args.schulartUri);
      if (!sa) return null;
      return `${PREFIXES}
SELECT DISTINCT ?uri (SAMPLE(?l) AS ?label) WHERE {
  ?s lp:LP_0000537 ?uri .
  ?uri rdfs:label ?l .
  ?s lp:LP_0000029 <${bl}> .${sa.filter}
  FILTER(lang(?l) = "de")
} GROUP BY ?uri ORDER BY ?label`;
    }

    case 'find_lehrplaene': {
      const bl = validateSparqlIri(args.bundeslandUri);
      const sf = validateSparqlIri(args.schulfachUri);
      if (!bl || !sf) return null;
      const sa = resolveOptionalSchulartFilter(args.schulartUri);
      if (!sa) return null;
      // Select Lehrpläne purely by their Bundesland + Schulfach (+ optional
      // Schulart). We deliberately do NOT add a `?s rdf:type/rdfs:subClassOf*
      // lp:LP_0000438` type gate: that transitive property path exceeds
      // Virtuoso's transitive temp-memory pool (HTTP 500 "Exceeded
      // 1000000000 bytes in transitive temp memory") the moment it is joined
      // with these selective IRI filters — no restructuring avoids it, and a
      // non-transitive single hop misses states (BE) that type their Lehrpläne
      // with a deeper subclass. The gate is redundant anyway: lp:LP_0000537
      // (Schulfach) is only ever asserted on Lehrplan-level nodes, so
      // Bundesland + Schulfach already uniquely identifies Lehrpläne.
      return `${PREFIXES}
SELECT DISTINCT ?s ?label WHERE {
  ?s lp:LP_0000029 <${bl}> .
  ?s lp:LP_0000537 <${sf}> .
  ?s rdfs:label ?label .${sa.filter}
} ORDER BY ?label LIMIT 50`;
    }

    case 'get_node_children': {
      const node = validateSparqlIri(args.nodeUri);
      if (!node) return null;
      // Topic-node labels in the state graphs are mostly untagged, so we
      // don't filter by language — a `lang(?l) = "de"` filter would silently
      // drop most of them.
      //
      // Has-part is materialised exclusively as obo:BFO_0000051. The ontology
      // declares lp:LP_0000008 ("hat Teil") as a sub-property, but no state
      // graph contains LP_0000008 triples and Virtuoso does no property-
      // hierarchy reasoning — always query the super-property.
      //
      // The data over-asserts BFO_0000051 transitively — a Lehrplan with 5
      // chapters and 100 leaf bullets emits all 105 as direct has-part
      // children of the Lehrplan. We want only the truly-direct children
      // (the 5 chapters), so we exclude any ?child that's also reachable
      // via an intermediate has-part hop from the same parent.
      //
      // Nodes carry their text under different predicates depending on the
      // source graph: the ISB (BY) / RP / SN imports use rdfs:label, while the
      // yovisto import (BE, BB) uses skos:prefLabel. Coalesce both — reading
      // only rdfs:label left every Berlin node unlabelled, so bindingsToItems
      // dropped them and the tree came back empty. SAMPLE + GROUP BY collapses
      // the row per child to one (a node with de+en prefLabels would otherwise
      // emit duplicate rows → duplicate keys crash the keyed {#each} in
      // CurriculumTree).
      return `${PREFIXES}
SELECT ?child (SAMPLE(?lbl) AS ?childLabel) (MAX(?hc) AS ?hasChildren)
WHERE {
  <${node}> obo:BFO_0000051 ?child .
  FILTER NOT EXISTS {
    <${node}> obo:BFO_0000051 ?intermediate .
    ?intermediate obo:BFO_0000051 ?child .
    FILTER(?intermediate != ?child)
  }
  OPTIONAL { ?child rdfs:label ?rl . }
  OPTIONAL { ?child skos:prefLabel ?pl . }
  BIND(COALESCE(?rl, ?pl) AS ?lbl)
  BIND(IF(EXISTS { ?child obo:BFO_0000051 ?gc }, 1, 0) AS ?hc)
} GROUP BY ?child ORDER BY DESC(?hasChildren) ?childLabel`;
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
  'get_node_children'
]);

/**
 * Convert SPARQL bindings to picker items. The id column varies by tool —
 * `?uri` for the term listings, `?s` for find_lehrplaene, `?child` for
 * get_node_children — so coalesce across the three shapes. The optional
 * `?hasChildren` is only emitted by get_node_children.
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
    // Virtuoso returns EXISTS as xsd:integer "1"/"0"; other SPARQL stores
    // return xsd:boolean "true"/"false". Accept both.
    if (b.hasChildren) {
      const v = b.hasChildren.value;
      item.hasChildren = v === 'true' || v === '1';
    }
    out.push(item);
  }
  return out;
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

  const items = bindingsToItems(result?.results?.bindings ?? []);
  return json({ items }, { headers: { 'cache-control': CACHE_HEADER } });
}
