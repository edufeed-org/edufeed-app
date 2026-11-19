/** @vitest-environment node */
// TERMI_AI_ENABLED → runtimeConfig.termi: {enabled, embed, llm} capability
// booleans for the LLM-backed Termi assistant. Keys never leave the server.
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** @param {Record<string, string>} env */
async function configWith(env) {
  vi.doMock('$env/dynamic/private', () => ({ env }));
  const { GET } = await import('../../routes/api/config/+server.js');
  return GET().json();
}

describe('GET /api/config — termi', () => {
  beforeEach(() => vi.resetModules());

  it('defaults to all off', async () => {
    const body = await configWith({});
    expect(body.termi).toEqual({ enabled: false, embed: false, llm: false });
  });

  it('flag on + embed vars set → embed true, llm false', async () => {
    const body = await configWith({
      TERMI_AI_ENABLED: 'true',
      TERMI_EMBED_URL: 'http://e',
      TERMI_EMBED_API_KEY: 'k'
    });
    expect(body.termi).toEqual({ enabled: true, embed: true, llm: false });
  });

  it('all vars set with an external model id → llm false', async () => {
    const body = await configWith({
      TERMI_AI_ENABLED: 'true',
      TERMI_EMBED_URL: 'http://e',
      TERMI_EMBED_API_KEY: 'k',
      TERMI_LLM_BASE_URL: 'http://l',
      TERMI_LLM_API_KEY: 'k2',
      TERMI_LLM_MODEL: 'gpt-5'
    });
    expect(body.termi).toEqual({ enabled: true, embed: true, llm: false });
  });

  it('all vars set with a non-external model id → llm true', async () => {
    const body = await configWith({
      TERMI_AI_ENABLED: 'true',
      TERMI_EMBED_URL: 'http://e',
      TERMI_EMBED_API_KEY: 'k',
      TERMI_LLM_BASE_URL: 'http://l',
      TERMI_LLM_API_KEY: 'k2',
      TERMI_LLM_MODEL: 'gemma-4-31b-it',
      NOPE_MCP_URL: 'https://mcp.example/mcp',
      TERMI_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org'
    });
    expect(body.termi).toEqual({ enabled: true, embed: true, llm: true });
  });

  it('all LLM vars set but no TERMI_ELIGIBLE_NIP05_DOMAINS → llm false (no gate-less assistant)', async () => {
    const body = await configWith({
      TERMI_AI_ENABLED: 'true',
      TERMI_LLM_BASE_URL: 'http://l',
      TERMI_LLM_API_KEY: 'k2',
      TERMI_LLM_MODEL: 'gemma-4-31b-it',
      NOPE_MCP_URL: 'https://mcp.example/mcp',
      TERMI_ELIGIBLE_NIP05_DOMAINS: ' , '
    });
    expect(body.termi.llm).toBe(false);
  });

  it('the legacy AMB_MCP_URL counts as the nope-mcp URL', async () => {
    const body = await configWith({
      TERMI_AI_ENABLED: 'true',
      TERMI_LLM_BASE_URL: 'http://l',
      TERMI_LLM_API_KEY: 'k2',
      TERMI_LLM_MODEL: 'gemma-4-31b-it',
      AMB_MCP_URL: 'https://mcp.example/mcp',
      TERMI_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org'
    });
    expect(body.termi.llm).toBe(true);
  });

  it('all LLM vars set but no nope-mcp URL → llm false (the chat route would 503)', async () => {
    const body = await configWith({
      TERMI_AI_ENABLED: 'true',
      TERMI_LLM_BASE_URL: 'http://l',
      TERMI_LLM_API_KEY: 'k2',
      TERMI_LLM_MODEL: 'gemma-4-31b-it'
    });
    expect(body.termi.llm).toBe(false);
  });

  it('flag off but all env set → everything false', async () => {
    const body = await configWith({
      TERMI_AI_ENABLED: 'false',
      TERMI_EMBED_URL: 'http://e',
      TERMI_EMBED_API_KEY: 'k',
      TERMI_LLM_BASE_URL: 'http://l',
      TERMI_LLM_API_KEY: 'k2',
      TERMI_LLM_MODEL: 'gemma-4-31b-it'
    });
    expect(body.termi).toEqual({ enabled: false, embed: false, llm: false });
  });

  it('never leaks the API keys into the response body', async () => {
    const body = await configWith({
      TERMI_AI_ENABLED: 'true',
      TERMI_EMBED_URL: 'http://e',
      TERMI_EMBED_API_KEY: 'SECRET-EMBED',
      TERMI_LLM_BASE_URL: 'http://l',
      TERMI_LLM_API_KEY: 'SECRET-LLM',
      TERMI_LLM_MODEL: 'gemma-4-31b-it'
    });
    expect(JSON.stringify(body)).not.toContain('SECRET-EMBED');
    expect(JSON.stringify(body)).not.toContain('SECRET-LLM');
  });

  // Answer feedback goes to this pubkey as a NIP-17 message over DM_RELAYS only.
  const FEEDBACK_HEX = '813e2e4e1dc92703fdba7d97817f85b691f1ff9e731ecd28fd2c8b179c20576a';
  const FEEDBACK_NPUB = 'npub1sylzunsaeyns8ld60ktczlu9k6glrlu7wv0v628a9j9308pq2a4qdhv5f8';

  it('exposes feedbackPubkey as hex when TERMI_FEEDBACK_NPUB and DM_RELAYS are set', async () => {
    const body = await configWith({
      TERMI_FEEDBACK_NPUB: FEEDBACK_NPUB,
      DM_RELAYS: 'wss://dm.example'
    });
    expect(body.termi.feedbackPubkey).toBe(FEEDBACK_HEX);
  });

  it('omits feedbackPubkey without DM_RELAYS (never the fallback relays)', async () => {
    const body = await configWith({ TERMI_FEEDBACK_NPUB: FEEDBACK_NPUB });
    expect(body.termi.feedbackPubkey).toBeUndefined();
  });

  it('omits feedbackPubkey for an invalid value', async () => {
    const body = await configWith({
      TERMI_FEEDBACK_NPUB: 'nonsense',
      DM_RELAYS: 'wss://dm.example'
    });
    expect(body.termi.feedbackPubkey).toBeUndefined();
  });
});
