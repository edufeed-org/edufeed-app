/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';

const PUBKEY = 'a'.repeat(64);
const ENV = {
  TERMI_AI_ENABLED: 'true',
  TERMI_LLM_BASE_URL: 'https://saia.example/v1',
  TERMI_LLM_API_KEY: 'sekret-key',
  TERMI_LLM_MODELS: 'glm-5.3,qwen3',
  TERMI_EXTERNAL_MODELS: 'claude-sonnet-5-5,claude-x',
  TERMI_ANTHROPIC_API_KEY: 'ak',
  TERMI_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org',
  NOPE_MCP_URL: 'https://mcp.example/mcp'
};

/**
 * @param {Record<string, string>} env
 * @param {{ signer?: string | null, listed?: boolean, saia?: any, cooldown?: string[], used?: number }} [o]
 */
async function load(env, { signer = PUBKEY, listed = false, saia, cooldown = [], used = 0 } = {}) {
  vi.resetModules();
  vi.doMock('$env/dynamic/private', () => ({ env }));
  vi.doMock('$lib/server/nip98-verify.js', () => ({
    verifyNip98Header: vi.fn(async () => signer)
  }));
  vi.doMock('$lib/server/termi/eligibility.js', async (orig) => ({
    .../** @type {object} */ (await orig()),
    getTermiEligibilityChecker: () => ({ gated: true, isEligible: async () => true })
  }));
  const isListed = vi.fn(async () => listed);
  vi.doMock('$lib/server/termi/external-access.js', () => ({
    getExternalAccess: () => ({ isListed })
  }));
  vi.doMock('$lib/server/termi/fallback-model.js', async (orig) => ({
    .../** @type {object} */ (await orig()),
    modelCooldown: { skip: (/** @type {string} */ id) => cooldown.includes(id), mark() {} }
  }));
  const fetchMock = vi.fn(async () => {
    if (saia === 'fail') throw new Error('down');
    return { ok: true, json: async () => ({ data: saia ?? [] }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  const authz = await import('$lib/server/termi/authorize.js');
  for (let i = 0; i < used; i++) authz.termiExternalQuota.charge(PUBKEY);
  const lock = vi.spyOn(authz, 'acquireChatLock');
  const charge = vi.spyOn(authz.termiQuota, 'charge');
  const echarge = vi.spyOn(authz.termiExternalQuota, 'charge');
  const { POST, GET } = await import('../../routes/api/termi/models/+server.js');
  const verify = /** @type {any} */ (await import('$lib/server/nip98-verify.js')).verifyNip98Header;
  const get = () =>
    GET(/** @type {any} */ ({ request: new Request('http://localhost/api/termi/models') }));
  const call = () =>
    POST(
      /** @type {any} */ ({
        request: new Request('http://localhost/api/termi/models', {
          method: 'POST',
          body: '{}',
          headers: { authorization: 'Nostr x' }
        })
      })
    );
  return { call, get, verify, isListed, lock, charge, echarge, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/termi/models', () => {
  it('an unlisted signer gets no external key at all, and is not even looked up', async () => {
    const t = await load(ENV, { listed: false });
    const res = await t.call();
    const body = await res.json();
    expect('external' in body).toBe(false);
    expect(body.default).toBe('saia:glm-5.3');
    expect(body.models.map((/** @type {any} */ m) => m.id)).toEqual(['saia:glm-5.3', 'saia:qwen3']);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(JSON.stringify(body)).not.toContain('sekret-key');
  });

  it('a listed signer gets the outside models and left = total - used', async () => {
    const t = await load(ENV, { listed: true, used: 3 });
    const body = await (await t.call()).json();
    expect(body.external.models).toEqual([
      { id: 'anthropic:claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
      { id: 'anthropic:claude-x', name: 'claude-x' }
    ]);
    expect(body.external.total).toBe(20);
    expect(body.external.left).toBe(17);
  });

  it('pins the three Anthropic names; any other id falls back to the bare id', async () => {
    const t = await load(
      {
        ...ENV,
        TERMI_EXTERNAL_MODELS: 'claude-sonnet-5-5,claude-haiku-5-5,claude-opus-5-5,claude-other'
      },
      { listed: true }
    );
    const body = await (await t.call()).json();
    expect(body.external.models.map((/** @type {any} */ m) => m.name)).toEqual([
      'Claude Sonnet 5.5',
      'Claude Haiku 5.5',
      'Claude Opus 5.5',
      'claude-other'
    ]);
  });

  it('never asks the access list when the catalog has no outside models', async () => {
    const t = await load({ ...ENV, TERMI_EXTERNAL_MODELS: '' }, { listed: true });
    const body = await (await t.call()).json();
    expect('external' in body).toBe(false);
    expect(t.isListed).not.toHaveBeenCalled();
  });

  it('SAIA status fetch failing: models come back without state', async () => {
    const t = await load(ENV, { saia: 'fail' });
    const body = await (await t.call()).json();
    expect(body.models).toEqual([
      { id: 'saia:glm-5.3', name: 'glm-5.3' },
      { id: 'saia:qwen3', name: 'qwen3' }
    ]);
  });

  it('reports state and name from SAIA; a cooled-down model is down', async () => {
    const t = await load(ENV, {
      saia: [
        { id: 'glm-5.3', name: 'GLM 5.3', status: 'ready', demand: 5 },
        { id: 'qwen3', name: 'Qwen 3', status: 'ready', demand: 0 }
      ],
      cooldown: ['saia:qwen3']
    });
    const body = await (await t.call()).json();
    expect(body.models).toEqual([
      { id: 'saia:glm-5.3', name: 'GLM 5.3', state: 'busy' },
      { id: 'saia:qwen3', name: 'Qwen 3', state: 'down' }
    ]);
  });

  it('an unsigned request gets 401', async () => {
    const t = await load(ENV, { signer: null });
    expect((await t.call()).status).toBe(401);
  });

  it('costs nothing: no lock, no quota step, answers when the quota is used up', async () => {
    const t = await load(ENV, { listed: true, used: 25 });
    const res = await t.call();
    expect(res.status).toBe(200);
    expect((await res.json()).external.left).toBe(0);
    expect(t.lock).not.toHaveBeenCalled();
    expect(t.charge).not.toHaveBeenCalled();
    expect(t.echarge).not.toHaveBeenCalled();
  });
});

describe('GET /api/termi/models (unsigned: the SAIA part only)', () => {
  it('no signature, the SAIA models, never an `external` key, never the access list', async () => {
    const t = await load(ENV, {
      listed: true,
      saia: [{ id: 'glm-5.3', name: 'GLM 5.3', status: 'ready', demand: 0 }]
    });
    const res = await t.get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      default: 'saia:glm-5.3',
      models: [
        { id: 'saia:glm-5.3', name: 'GLM 5.3', state: 'ready' },
        { id: 'saia:qwen3', name: 'qwen3' }
      ]
    });
    expect(res.headers.get('cache-control')).toBe('private, max-age=30');
    expect(t.isListed).not.toHaveBeenCalled();
    expect(t.verify).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('anthropic');
  });

  it('503 when the LLM is not configured', async () => {
    const t = await load({ ...ENV, TERMI_LLM_BASE_URL: '' });
    const res = await t.get();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('termi_llm_disabled');
  });
});
