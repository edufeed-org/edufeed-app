/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: {
    SPARQL_ENDPOINT_URL: 'https://sparql.example/sparql/'
  }
}));

const queryMock = vi.fn();
vi.mock('$lib/server/sparqlClient.js', () => ({
  query: (/** @type {any} */ args) => queryMock(args)
}));

/**
 * Build a Request for the POST handler.
 * @param {object} body
 */
function postRequest(body) {
  return new Request('http://localhost/api/curricula', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/**
 * Cast a partial RequestEvent for tests. SvelteKit's full type has many
 * runtime-only fields the route doesn't touch.
 * @param {Request} request
 * @returns {any}
 */
function ev(request) {
  return { request };
}

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
    expect(callArg.sparql).toMatch(/lp:LP_0000029/);
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

  it('get_lehrplan_tree: substitutes lehrplanUri and parses parent/child rows into deduped nodes', async () => {
    const lehrplan = 'https://lp-bavaria.org/lis_live_isb.c.221348.de';
    const planet = 'https://lp-bavaria.org/lis_live_isb.c.221308.de';
    const einzig = 'https://lp-bavaria.org/3463992d';
    queryMock.mockResolvedValueOnce(
      sparqlResponse(
        ['parent', 'parentLabel', 'child', 'childLabel'],
        [
          {
            parent: { type: 'uri', value: lehrplan },
            parentLabel: { type: 'literal', value: 'Geographie 5' },
            child: { type: 'uri', value: planet },
            childLabel: { type: 'literal', value: 'Planet Erde' }
          },
          {
            parent: { type: 'uri', value: planet },
            parentLabel: { type: 'literal', value: 'Planet Erde' },
            child: { type: 'uri', value: einzig },
            childLabel: { type: 'literal', value: 'Einzigartigkeit' }
          }
        ]
      )
    );
    const { POST } = await import('../../routes/api/curricula/+server.js');
    const res = await POST(
      ev(
        postRequest({
          tool: 'get_lehrplan_tree',
          args: { lehrplanUri: lehrplan }
        })
      )
    );
    const body = await res.json();
    expect(body.nodes).toEqual([
      { id: planet, label: 'Planet Erde', parentId: null },
      { id: einzig, label: 'Einzigartigkeit', parentId: planet }
    ]);
    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toContain(`<${lehrplan}>`);
    expect(sparql).toMatch(/lp:LP_0000008/);
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
    expect(sparql).toMatch(/lp:LP_0000008/);
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

  it('get_lehrplan_tree: queries both lp:LP_0000008 and obo:BFO_0000051 (multi-state predicate union)', async () => {
    // Background: Bayern's data uses lp:LP_0000008 ("hat Teil"); other states
    // (Rheinland-Pfalz, Sachsen, …) only carry the standard BFO "has part"
    // predicate obo:BFO_0000051. Querying just one returns an empty tree for
    // those states. The route must walk both via a SPARQL alternation path.
    queryMock.mockResolvedValueOnce(sparqlResponse(['parent', 'child', 'childLabel'], []));
    const { POST } = await import('../../routes/api/curricula/+server.js');
    await POST(
      ev(
        postRequest({
          tool: 'get_lehrplan_tree',
          args: { lehrplanUri: 'https://lp-rlp.org/resource/356' }
        })
      )
    );
    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toMatch(/lp:LP_0000008/);
    expect(sparql).toMatch(/obo:BFO_0000051/);
    expect(sparql).toMatch(/PREFIX\s+obo:/);
  });

  it('get_node_children: queries both lp:LP_0000008 and obo:BFO_0000051 (multi-state predicate union)', async () => {
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
    expect(sparql).toMatch(/lp:LP_0000008/);
    expect(sparql).toMatch(/obo:BFO_0000051/);
    expect(sparql).toMatch(/PREFIX\s+obo:/);
  });

  it('get_node_children: prefers lp:LP_0000008 with a NOT EXISTS fallback to obo:BFO_0000051', async () => {
    // Bayern carries both lp:LP_0000008 ("hat Teil") and obo:BFO_0000051
    // ("has part"). LP_0000008 is Bayern's clean table-of-contents (e.g. 7
    // chapters on Geographie 5); BFO_0000051 is the full flattened has-part
    // graph (chapters + every leaf bullet, ~70 entries). A naive alternation
    // path returns the noisy 70-entry view for Bayern. RP/SN carry only
    // BFO_0000051, so we still need to fall back to it when LP_0000008 is
    // empty for the node in question. Pattern:
    //   { ?node lp:LP_0000008 ?child }
    //   UNION
    //   { ?node obo:BFO_0000051 ?child .
    //     FILTER NOT EXISTS { ?node lp:LP_0000008 ?_ } }
    queryMock.mockResolvedValueOnce(sparqlResponse(['child', 'childLabel'], []));
    const { POST } = await import('../../routes/api/curricula/+server.js');
    await POST(
      ev(
        postRequest({
          tool: 'get_node_children',
          args: { nodeUri: 'https://lp-bavaria.org/lis_live_isb.c.1800.de' }
        })
      )
    );
    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toMatch(/lp:LP_0000008/);
    expect(sparql).toMatch(/obo:BFO_0000051/);
    expect(sparql).toMatch(/FILTER\s+NOT\s+EXISTS/i);
  });

  it('get_node_children: orders branchy children before leaves (DESC hasChildren, then label)', async () => {
    // For states without an LP_0000008 TOC (RP, SN), the BFO fallback returns
    // 100+ root children mixing categories and leaf bullet points. Sorting
    // alphabetically buries the category nodes behind a wall of "..." bullets.
    // ORDER BY DESC(?hasChildren) lifts categories to the top.
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

  it('get_lehrplan_tree: prefers lp:LP_0000008 with a NOT EXISTS fallback to obo:BFO_0000051', async () => {
    queryMock.mockResolvedValueOnce(sparqlResponse(['parent', 'child', 'childLabel'], []));
    const { POST } = await import('../../routes/api/curricula/+server.js');
    await POST(
      ev(
        postRequest({
          tool: 'get_lehrplan_tree',
          args: { lehrplanUri: 'https://lp-bavaria.org/lis_live_isb.c.1800.de' }
        })
      )
    );
    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toMatch(/lp:LP_0000008/);
    expect(sparql).toMatch(/obo:BFO_0000051/);
    expect(sparql).toMatch(/FILTER\s+NOT\s+EXISTS/i);
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
