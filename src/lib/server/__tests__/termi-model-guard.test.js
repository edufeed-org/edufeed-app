/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { isTermiLlmConfigured, termiLlmProvider } from '../termi/model-guard.js';
import { createTermiModel } from '../termi/llm.js';

const base = {
  TERMI_AI_ENABLED: 'true',
  TERMI_LLM_BASE_URL: 'https://chat-ai.academiccloud.de/v1',
  TERMI_LLM_API_KEY: 'k',
  TERMI_LLM_MODEL: 'glm-5.3',
  NOPE_MCP_URL: 'https://mcp.example/mcp',
  TERMI_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org'
};

describe('Termi LLM provider guard', () => {
  it('SAIA (default) runs an open model and refuses external ids', () => {
    expect(termiLlmProvider(base)).toBe('saia');
    expect(isTermiLlmConfigured(base)).toBe(true);
    expect(isTermiLlmConfigured({ ...base, TERMI_LLM_MODEL: 'claude-sonnet-5' })).toBe(false);
    expect(isTermiLlmConfigured({ ...base, TERMI_LLM_MODEL: 'gpt-5' })).toBe(false);
    expect(createTermiModel(base)?.modelId).toBe('glm-5.3');
  });

  it('anthropic is an explicit opt-in: claude-* id, no base URL needed, nothing else accepted', () => {
    const env = {
      ...base,
      TERMI_LLM_PROVIDER: 'anthropic',
      TERMI_LLM_BASE_URL: undefined,
      TERMI_LLM_MODEL: 'claude-sonnet-5'
    };
    expect(termiLlmProvider(env)).toBe('anthropic');
    expect(isTermiLlmConfigured(env)).toBe(true);
    expect(createTermiModel(env)?.provider).toMatch(/anthropic/);
    expect(isTermiLlmConfigured({ ...env, TERMI_LLM_MODEL: 'glm-5.3' })).toBe(false);
    expect(isTermiLlmConfigured({ ...env, TERMI_LLM_MODEL: 'gpt-5' })).toBe(false);
    expect(isTermiLlmConfigured({ ...env, TERMI_LLM_API_KEY: '' })).toBe(false);
  });
});
