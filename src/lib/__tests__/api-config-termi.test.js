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
      NOPE_MCP_URL: 'https://mcp.example/mcp'
    });
    expect(body.termi).toEqual({ enabled: true, embed: true, llm: true });
  });

  it('the legacy AMB_MCP_URL counts as the nope-mcp URL', async () => {
    const body = await configWith({
      TERMI_AI_ENABLED: 'true',
      TERMI_LLM_BASE_URL: 'http://l',
      TERMI_LLM_API_KEY: 'k2',
      TERMI_LLM_MODEL: 'gemma-4-31b-it',
      AMB_MCP_URL: 'https://mcp.example/mcp'
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
});
