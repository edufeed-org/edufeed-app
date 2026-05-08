/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { query } from '../sparqlClient.js';

const ENDPOINT = 'https://sparql.example/sparql/';

describe('sparqlClient.query', () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs raw SPARQL with the correct content-type and accept headers', async () => {
    const sparql = 'SELECT * WHERE { ?s ?p ?o } LIMIT 1';
    const responseBody = {
      head: { vars: ['s', 'p', 'o'] },
      results: { bindings: [] }
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/sparql-results+json' }
      })
    );

    const out = await query({ endpoint: ENDPOINT, sparql });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/sparql-query');
    expect(init.headers['Accept']).toBe('application/sparql-results+json');
    expect(init.body).toBe(sparql);
    expect(out).toEqual(responseBody);
  });

  it('passes through head.vars and results.bindings unchanged', async () => {
    const responseBody = {
      head: { vars: ['uri', 'label'] },
      results: {
        bindings: [
          {
            uri: { type: 'uri', value: 'https://w3id.org/lehrplan/ontology/LP_3000051' },
            label: { type: 'literal', 'xml:lang': 'de', value: 'Bayern' }
          }
        ]
      }
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(responseBody), { status: 200 }));

    const out = await query({ endpoint: ENDPOINT, sparql: 'SELECT ?uri ?label WHERE {}' });
    expect(out.head.vars).toEqual(['uri', 'label']);
    expect(out.results.bindings).toHaveLength(1);
    expect(out.results.bindings[0].label.value).toBe('Bayern');
  });

  it('throws when the endpoint responds with a non-2xx status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad query', { status: 400 }));
    await expect(query({ endpoint: ENDPOINT, sparql: 'BROKEN' })).rejects.toThrow(/400/);
  });

  it('throws when the response body is not valid JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>not json</html>', { status: 200 }));
    await expect(query({ endpoint: ENDPOINT, sparql: 'SELECT * WHERE {}' })).rejects.toThrow();
  });
});
