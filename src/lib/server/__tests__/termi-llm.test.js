/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
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

  it('logs the provider message of an HTTP error, capped, never the request body', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(
      new Error(
        'messages.2.content.0.text: text content blocks\nmust be non-empty ' + 'x'.repeat(400)
      ),
      {
        statusCode: 400,
        requestBodyValues: { messages: 'SECRET user text' }
      }
    );
    expect(streamErrorMessage(err)).toBe('termi:upstream');
    const logged = spy.mock.calls[0].join(' ');
    spy.mockRestore();
    expect(logged).toContain('400');
    expect(logged).toContain('text content blocks must be non-empty');
    expect(logged).not.toContain('SECRET');
    expect(logged.length).toBeLessThan(360);
  });

  it('logs no message for a non-HTTP error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    streamErrorMessage(new Error('prompt echo'));
    const logged = spy.mock.calls[0].join(' ');
    spy.mockRestore();
    expect(logged).not.toContain('prompt echo');
  });
});
