/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { isTermiLlmConfigured } from '../termi/model-guard.js';
import { createTermiModel } from '../termi/llm.js';

const base = {
  TERMI_AI_ENABLED: 'true',
  TERMI_LLM_BASE_URL: 'https://chat-ai.academiccloud.de/v1',
  TERMI_LLM_API_KEY: 'k',
  TERMI_LLM_MODEL: 'glm-5.3',
  NOPE_MCP_URL: 'https://mcp.example/mcp',
  TERMI_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org'
};

describe('Termi LLM guard', () => {
  it('runs an open model and refuses external ids', () => {
    expect(isTermiLlmConfigured(base)).toBe(true);
    expect(isTermiLlmConfigured({ ...base, TERMI_LLM_MODEL: 'claude-sonnet-5' })).toBe(false);
    expect(isTermiLlmConfigured({ ...base, TERMI_LLM_MODEL: 'gpt-5' })).toBe(false);
    expect(createTermiModel(base)?.modelId).toBe('glm-5.3');
  });

  it('accepts a TERMI_LLM_MODELS list and needs at least one usable entry', () => {
    const list = { ...base, TERMI_LLM_MODEL: undefined, TERMI_LLM_MODELS: 'gpt-5, glm-5.3' };
    expect(isTermiLlmConfigured(list)).toBe(true);
    expect(createTermiModel(list)?.modelId).toBe('glm-5.3');
    expect(isTermiLlmConfigured({ ...list, TERMI_LLM_MODELS: 'gpt-5' })).toBe(false);
  });
});
