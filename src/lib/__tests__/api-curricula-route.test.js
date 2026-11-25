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
    // The states are the members MEM enumerates for the Bundesland class
    // (LP_0000040 owl:equivalentClass/owl:oneOf). The state data does not
    // assert `a lp:LP_0000040` — that type exists only in FWU's inferences
    // graphs, so a store with the data graphs alone listed only Berlin.
    expect(callArg.sparql).toMatch(/lp:LP_0000040\s+owl:equivalentClass/);
    expect(callArg.sparql).toMatch(/owl:oneOf/);
    expect(callArg.sparql).not.toMatch(/\ba\s+lp:LP_0000040/);
    // Only surface states that actually carry curriculum data — 12 of the 16
    // typed Bundesland instances have no Lehrpläne, and selecting them yields
    // an empty cascade. Join from the Schulfach-bearing Lehrpläne (LP_0000537);
    // the FILTER EXISTS form took 29 s on the live endpoint (issue wcad3rnu).
    expect(callArg.sparql).not.toMatch(/FILTER\s+EXISTS/i);
    expect(callArg.sparql).toMatch(/lp:LP_0000537/);
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
    // Select Lehrpläne by their Schulfach (LP_0000537), which is a
    // Lehrplan-exclusive predicate. Must NOT use an rdfs:subClassOf* type
    // gate: that transitive path exceeds Virtuoso's transitive temp memory
    // (HTTP 500) once joined with the selective Bundesland/Schulfach filters.
    expect(sparql).toMatch(/lp:LP_0000537/);
    expect(sparql).not.toMatch(/subClassOf/i);
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
    expect(sparql).toMatch(/EXISTS\s*\{\s*\?child\s+lp:LP_0000565/);
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
    // No transitive type gate — see the "substitutes all three URIs" test.
    expect(sparql).not.toMatch(/subClassOf/i);
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

  it('get_node_children: follows lp:LP_0000565 "hat direkten Teil", not the inferred has-part', async () => {
    // MEM asserts the tree as lp:LP_0000565 (has direct part, a sub-property
    // of obo:BFO_0000051) in the state data graphs. BFO_0000051 itself exists
    // only in FWU's inferences graphs, transitively; lp:LP_0000008 is never
    // asserted, and Virtuoso does no property reasoning.
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
    expect(sparql).toMatch(/<https:\/\/lp-rlp\.org\/resource\/27386>\s+lp:LP_0000565\s+\?child/);
    expect(sparql).not.toMatch(/BFO_0000051/);
    expect(sparql).not.toMatch(/lp:LP_0000008/);
  });

  it('get_node_children: labels nodes from rdfs:label OR skos:prefLabel', async () => {
    // Source graphs disagree on the label predicate: the ISB (BY) / RP / SN
    // imports use rdfs:label, but the yovisto import (BE, BB) uses
    // skos:prefLabel. Reading only rdfs:label left every Berlin node
    // unlabelled → bindingsToItems dropped them → empty tree. Coalesce both,
    // and GROUP BY the child so a node with multiple prefLabels collapses to a
    // single row (duplicate ?child rows would crash the keyed {#each}).
    queryMock.mockResolvedValueOnce(sparqlResponse(['child', 'childLabel', 'hasChildren'], []));
    const { POST } = await import('../../routes/api/curricula/+server.js');
    await POST(
      ev(
        postRequest({
          tool: 'get_node_children',
          args: { nodeUri: 'https://lehrplan.yovisto.com/resource/lp/be/curriculum/15' }
        })
      )
    );
    const sparql = queryMock.mock.calls[0][0].sparql;
    expect(sparql).toMatch(/PREFIX\s+skos:/);
    expect(sparql).toMatch(/skos:prefLabel/);
    expect(sparql).toMatch(/rdfs:label/);
    expect(sparql).toMatch(/COALESCE/i);
    expect(sparql).toMatch(/GROUP\s+BY\s+\?child/i);
  });

  it('get_node_children: needs no intermediate-hop filter (the direct edge has no transitive over-assertion)', async () => {
    // The inferred BFO_0000051 lists every descendant as a part, so the old
    // query had to drop children reachable via an intermediate node. The
    // asserted LP_0000565 edge already holds the direct children only.
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
    expect(sparql).not.toMatch(/FILTER\s+NOT\s+EXISTS/i);
    expect(sparql).not.toMatch(/\?intermediate/);
  });

  it('get_node_children: curriculum order first (lp:LP_0000460), then branchy before leaves, then label', async () => {
    // MEM gives positions ("hat Position", LP_0000460) for most Bavarian and
    // some Saxon nodes; where it does, the tree follows the curriculum. Without
    // positions, category-like nodes ("Lesen", "Schreiben") go before leaf
    // bullet points (DESC ?hasChildren), then alphabetical.
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
    expect(sparql).toMatch(/OPTIONAL\s*\{\s*\?child\s+lp:LP_0000460\s+\?p\s*\}/);
    expect(sparql).toMatch(/ORDER\s+BY\s+\?position\s+DESC\(\s*\?hasChildren\s*\)\s+\?childLabel/i);
  });

  it('get_node_children: caps the result size with a LIMIT', async () => {
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
    expect(queryMock.mock.calls[0][0].sparql).toMatch(/LIMIT 1000\s*$/);
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
