/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { createTermiModel, streamErrorMessage } from '../termi/llm.js';

const ENV = {
  TERMI_AI_ENABLED: 'true',
  TERMI_LLM_BASE_URL: 'https://chat-ai.academiccloud.de/v1',
  TERMI_LLM_API_KEY: 'k',
  TERMI_LLM_MODEL: 'qwen3-30b-a3b-instruct-2507',
  NOPE_MCP_URL: 'https://mcp.example/mcp',
  TERMI_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org'
};

describe('createTermiModel', () => {
  it('builds a chat-completions model when fully configured', () => {
    const model = /** @type {any} */ (createTermiModel(ENV));
    expect(model.modelId).toBe('qwen3-30b-a3b-instruct-2507');
    expect(model.provider).toMatch(/\.chat$/);
  });

  it.each([
    ['flag off', { ...ENV, TERMI_AI_ENABLED: 'false' }],
    ['model unset', { ...ENV, TERMI_LLM_MODEL: '' }],
    ['key unset', { ...ENV, TERMI_LLM_API_KEY: undefined }],
    ['no eligible NIP-05 domain', { ...ENV, TERMI_ELIGIBLE_NIP05_DOMAINS: '' }],
    ['external model', { ...ENV, TERMI_LLM_MODEL: 'claude-sonnet-5' }]
  ])('returns null when %s', (_label, env) => {
    expect(createTermiModel(env)).toBeNull();
  });
});

describe('streamErrorMessage', () => {
  it('maps any upstream error to the opaque termi:upstream marker', () => {
    expect(streamErrorMessage(new Error('429 secret upstream detail'))).toBe('termi:upstream');
    expect(streamErrorMessage('x')).toBe('termi:upstream');
  });
});
