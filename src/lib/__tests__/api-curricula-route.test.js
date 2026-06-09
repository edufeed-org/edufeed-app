/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postJson, ev } from './apiRoute.fixtures.js';

vi.mock('$env/dynamic/private', () => ({
  env: {
    SPARQL_ENDPOINT_URL: 'https://sparql.example/sparql/'
  }
}));

const queryMock = vi.fn();
vi.mock('$lib/server/sparqlClient.js', () => ({
  query: (/** @type {any} */ args) => queryMock(args)
}));

/** @param {Record<string, unknown>} body */
const postRequest = (body) => postJson('/api/curricula', body);

/**
 * Build a SPARQL-JSON response.
 * @param {string[]} vars
 * @param {Record<string, { type: string, value: string, datatype?: string }>[]} bindings
 */
function sparqlResponse(vars, bindings) {
  return { head: { vars }, results: { bindings } };
}

describe('POST /api/curricula (SPARQL backend)', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('list_bundeslaender: parses uri/label bindings into items', async () => {
    queryMock.mockResolvedValueOnce(
      sparqlResponse(
        ['uri', 'label'],
        [
          {
            uri: { type: 'uri', value: 'https://w3id.org/lehrplan/ontology/LP_3000051' },
            label: { type: 'literal', value: 'Bayern' }
          },
          {
            uri: { type: 'uri', value: 'https://w3id.org/lehrplan/ontology/LP_3000050' },
            label: { type: 'literal', value: 'Hessen' }
          }
        ]
      )
    );
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(ev(postRequest({ tool: 'list_bundeslaender', args: {} })));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/);
    const body = await res.json();
    expect(body.items).toEqual([
      { id: 'https://w3id.org/lehrplan/ontology/LP_3000051', label: 'Bayern' },
      { id: 'https://w3id.org/lehrplan/ontology/LP_3000050', label: 'Hessen' }
    ]);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const callArg = queryMock.mock.calls[0][0];
    expect(callArg.endpoint).toBe('https://sparql.example/sparql/');
    // Query the Bundesland class directly, not via reverse lp:LP_0000029 scan
    // (that reverse-scan walks ~1.6M triples to find 16 distinct objects).
    expect(callArg.sparql).toMatch(/lp:LP_0000040/);
    expect(callArg.sparql).not.toMatch(/lp:LP_0000029/);
  });

  it('list_schularten: substitutes the bundesland URI into the query', async () => {
    queryMock.mockResolvedValueOnce(
      sparqlResponse(
        ['uri', 'label'],
        [
          {
            uri: { type: 'uri', value: 'https://w3id.org/schulart/BY_0000005' },
            label: { type: 'literal', value: 'Gymnasium' }
          }
        ]
      )
    );
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(
      ev(
        postRequest({
          tool: 'list_schularten',
          args: { bundeslandUri: 'https://w3id.org/lehrplan/ontology/LP_3000051' }
        })
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([
      { id: 'https://w3id.org/schulart/BY_0000005', label: 'Gymnasium' }
    ]);

    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toContain('<https://w3id.org/lehrplan/ontology/LP_3000051>');
    expect(sparql).toMatch(/lp:LP_0000812/);
    expect(sparql).toMatch(/lp:LP_0000029/);
  });

  it('list_schulfaecher: substitutes both URIs', async () => {
    queryMock.mockResolvedValueOnce(
      sparqlResponse(
        ['uri', 'label'],
        [
          {
            uri: { type: 'uri', value: 'https://w3id.org/schulfach/BY_0000030' },
            label: { type: 'literal', value: 'Geographie' }
          }
        ]
      )
    );
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(
      ev(
        postRequest({
          tool: 'list_schulfaecher',
          args: {
            bundeslandUri: 'https://w3id.org/lehrplan/ontology/LP_3000051',
            schulartUri: 'https://w3id.org/schulart/BY_0000005'
          }
        })
      )
    );
    const body = await res.json();
    expect(body.items).toEqual([
      { id: 'https://w3id.org/schulfach/BY_0000030', label: 'Geographie' }
    ]);
    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toContain('<https://w3id.org/lehrplan/ontology/LP_3000051>');
    expect(sparql).toContain('<https://w3id.org/schulart/BY_0000005>');
    expect(sparql).toMatch(/lp:LP_0000537/);
  });

  it('find_lehrplaene: substitutes all three URIs and parses s/label bindings', async () => {
    queryMock.mockResolvedValueOnce(
      sparqlResponse(
        ['s', 'label'],
        [
          {
            s: { type: 'uri', value: 'https://lp-bavaria.org/lis_live_isb.c.221348.de' },
            label: { type: 'literal', value: 'Geographie 5' }
          }
        ]
      )
    );
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(
      ev(
        postRequest({
          tool: 'find_lehrplaene',
          args: {
            bundeslandUri: 'https://w3id.org/lehrplan/ontology/LP_3000051',
            schulartUri: 'https://w3id.org/schulart/BY_0000005',
            schulfachUri: 'https://w3id.org/schulfach/BY_0000030'
          }
        })
      )
    );
    const body = await res.json();
    expect(body.items).toEqual([
      { id: 'https://lp-bavaria.org/lis_live_isb.c.221348.de', label: 'Geographie 5' }
    ]);
    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toContain('<https://w3id.org/lehrplan/ontology/LP_3000051>');
    expect(sparql).toContain('<https://w3id.org/schulart/BY_0000005>');
    expect(sparql).toContain('<https://w3id.org/schulfach/BY_0000030>');
  });

  it('get_node_children: substitutes nodeUri and parses child/childLabel/hasChildren bindings', async () => {
    const parent = 'https://lp-bavaria.org/lis_live_isb.c.221308.de';
    const childA = 'https://lp-bavaria.org/3463992d';
    const childB = 'https://lp-bavaria.org/abcdef01';
    queryMock.mockResolvedValueOnce(
      sparqlResponse(
        ['child', 'childLabel', 'hasChildren'],
        [
          {
            child: { type: 'uri', value: childA },
            childLabel: { type: 'literal', value: 'Einzigartigkeit' },
            // Virtuoso shape: EXISTS comes back as xsd:integer "1"/"0".
            hasChildren: {
              type: 'literal',
              datatype: 'http://www.w3.org/2001/XMLSchema#integer',
              value: '1'
            }
          },
          {
            child: { type: 'uri', value: childB },
            childLabel: { type: 'literal', value: 'Vielfalt' },
            hasChildren: {
              type: 'literal',
              datatype: 'http://www.w3.org/2001/XMLSchema#integer',
              value: '0'
            }
          }
        ]
      )
    );
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(
      ev(postRequest({ tool: 'get_node_children', args: { nodeUri: parent } }))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([
      { id: childA, label: 'Einzigartigkeit', hasChildren: true },
      { id: childB, label: 'Vielfalt', hasChildren: false }
    ]);
    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toContain(`<${parent}>`);
    expect(sparql).toMatch(/obo:BFO_0000051/);
    expect(sparql).toMatch(/EXISTS/);
  });

  it('list_schulfaecher: omits the Schulart filter when schulartUri is not provided ("Alle Schularten")', async () => {
    // Rationale: RP only tags Schulart on ~10 of its Lehrpläne, so a strict
    // Schulart filter hides perfectly valid subjects like Mathematik. When the
    // picker offers "Alle Schularten", the frontend omits schulartUri; the
    // route must then build a SPARQL without the LP_0000812 filter, keeping
    // only Bundesland.
    queryMock.mockResolvedValueOnce(sparqlResponse(['uri', 'label'], []));
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(
      ev(
        postRequest({
          tool: 'list_schulfaecher',
          args: { bundeslandUri: 'https://w3id.org/lehrplan/ontology/LP_3000046' }
        })
      )
    );
    expect(res.status).toBe(200);
    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toContain('<https://w3id.org/lehrplan/ontology/LP_3000046>');
    expect(sparql).toMatch(/lp:LP_0000537/);
    expect(sparql).not.toMatch(/lp:LP_0000812/);
  });

  it('find_lehrplaene: omits the Schulart filter when schulartUri is not provided', async () => {
    queryMock.mockResolvedValueOnce(sparqlResponse(['s', 'label'], []));
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(
      ev(
        postRequest({
          tool: 'find_lehrplaene',
          args: {
            bundeslandUri: 'https://w3id.org/lehrplan/ontology/LP_3000046',
            schulfachUri: 'https://w3id.org/schulfach/RP_0000035'
          }
        })
      )
    );
    expect(res.status).toBe(200);
    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toContain('<https://w3id.org/lehrplan/ontology/LP_3000046>');
    expect(sparql).toContain('<https://w3id.org/schulfach/RP_0000035>');
    expect(sparql).not.toMatch(/lp:LP_0000812/);
  });

  it('list_schulfaecher: still rejects a non-empty but malformed schulartUri', async () => {
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(
      ev(
        postRequest({
          tool: 'list_schulfaecher',
          args: {
            bundeslandUri: 'https://w3id.org/lehrplan/ontology/LP_3000046',
            schulartUri: 'not-a-url'
          }
        })
      )
    );
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('get_node_children: traverses obo:BFO_0000051 with the obo prefix declared', async () => {
    // State data graphs materialise the has-part relation exclusively via
    // obo:BFO_0000051. The sub-property lp:LP_0000008 is declared in the
    // ontology but never present in data, and Virtuoso does no property-
    // hierarchy reasoning.
    queryMock.mockResolvedValueOnce(sparqlResponse(['child', 'childLabel'], []));
    const { POST } = await import('../../routes/api/curricula/+server.js');
    await POST(
      ev(
        postRequest({
          tool: 'get_node_children',
          args: { nodeUri: 'https://lp-rlp.org/resource/27386' }
        })
      )
    );
    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toMatch(/obo:BFO_0000051/);
    expect(sparql).toMatch(/PREFIX\s+obo:/);
    expect(sparql).not.toMatch(/lp:LP_0000008/);
  });

  it('get_node_children: filters transitive BFO_0000051 over-assertion', async () => {
    // State data over-asserts has-part transitively: a Lehrplan with 5
    // chapters and 100 leaves emits all 105 nodes as direct BFO_0000051
    // children. Without a FILTER NOT EXISTS clause excluding children
    // reachable via an intermediate hop, the picker shows the flattened set.
    queryMock.mockResolvedValueOnce(sparqlResponse(['child', 'childLabel'], []));
    const { POST } = await import('../../routes/api/curricula/+server.js');
    await POST(
      ev(
        postRequest({
          tool: 'get_node_children',
          args: { nodeUri: 'https://lp-rlp.org/resource/155' }
        })
      )
    );
    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toMatch(/FILTER\s+NOT\s+EXISTS/i);
    expect(sparql).toMatch(/\?intermediate\s+obo:BFO_0000051\s+\?child/);
  });

  it('get_node_children: orders branchy children before leaves (DESC hasChildren, then label)', async () => {
    // Root-level nodes can mix category-like nodes ("Lesen", "Schreiben") with
    // leaf bullet points. Sorting alphabetically buries the categories behind a
    // wall of bullets; ORDER BY DESC(?hasChildren) lifts them to the top.
    queryMock.mockResolvedValueOnce(sparqlResponse(['child', 'childLabel'], []));
    const { POST } = await import('../../routes/api/curricula/+server.js');
    await POST(
      ev(
        postRequest({
          tool: 'get_node_children',
          args: { nodeUri: 'https://lp-rlp.org/resource/141' }
        })
      )
    );
    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toMatch(/ORDER\s+BY\s+DESC\(\s*\?hasChildren\s*\)/i);
  });

  it('get_node_children: rejects malformed nodeUri (injection guard)', async () => {
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(
      ev(
        postRequest({
          tool: 'get_node_children',
          args: { nodeUri: 'https://evil.example/x> } DROP { ?s ?p ?o' }
        })
      )
    );
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('get_node_children: returns empty items for a node with no children', async () => {
    queryMock.mockResolvedValueOnce(sparqlResponse(['child', 'childLabel'], []));
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(
      ev(
        postRequest({
          tool: 'get_node_children',
          args: { nodeUri: 'https://lp-bavaria.org/some-leaf' }
        })
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  it('returns empty items when SPARQL returns no bindings', async () => {
    queryMock.mockResolvedValueOnce(sparqlResponse(['uri', 'label'], []));
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(
      ev(
        postRequest({
          tool: 'list_schularten',
          args: { bundeslandUri: 'https://w3id.org/lehrplan/ontology/LP_9999999' }
        })
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  it('rejects unknown tool names', async () => {
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(ev(postRequest({ tool: 'evil_tool', args: {} })));
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects URIs containing forbidden characters (SPARQL-injection guard)', async () => {
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(
      ev(
        postRequest({
          tool: 'list_schularten',
          args: { bundeslandUri: 'https://evil.example/x> } DROP { ?s ?p ?o' }
        })
      )
    );
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects non-URL URI args', async () => {
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(
      ev(postRequest({ tool: 'list_schularten', args: { bundeslandUri: 'not-a-url' } }))
    );
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 502 when the SPARQL client throws', async () => {
    queryMock.mockRejectedValueOnce(new Error('boom'));
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(ev(postRequest({ tool: 'list_bundeslaender', args: {} })));
    expect(res.status).toBe(502);
  });

  it('returns 503 when SPARQL_ENDPOINT_URL is not configured', async () => {
    vi.resetModules();
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    vi.doMock('$lib/server/sparqlClient.js', () => ({
      query: (/** @type {any} */ args) => queryMock(args)
    }));
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(ev(postRequest({ tool: 'list_bundeslaender', args: {} })));
    expect(res.status).toBe(503);
  });
});
