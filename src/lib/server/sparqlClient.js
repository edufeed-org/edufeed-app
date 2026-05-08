/**
 * Stateless SPARQL 1.1 query client.
 *
 * Single round-trip POST against the configured endpoint. Used by
 * `/api/curricula` to drive the curriculum-picker cascade against the
 * publicly reachable Lehrplan ontology Virtuoso at sparql.mem.edufeed.org.
 *
 * Body is the raw SPARQL string (no JSON wrapping) — Virtuoso accepts this
 * via `Content-Type: application/sparql-query`. Response is the standard
 * SPARQL 1.1 JSON results format: `{ head: { vars }, results: { bindings } }`.
 */

/**
 * Run a SPARQL query and return the parsed SPARQL-JSON response.
 *
 * @param {object} params
 * @param {string} params.endpoint - Full SPARQL endpoint URL.
 * @param {string} params.sparql - Raw SPARQL query text.
 * @returns {Promise<{ head: { vars: string[] }, results: { bindings: Record<string, { type: string, value: string }>[] } }>}
 */
export async function query({ endpoint, sparql }) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json'
    },
    body: sparql
  });
  if (!res.ok) {
    throw new Error(`SPARQL endpoint returned HTTP ${res.status}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `SPARQL endpoint returned non-JSON body: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
