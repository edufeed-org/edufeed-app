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

  const httpError = () =>
    Object.assign(new Error('MARKER-user-text text content blocks must be non-empty'), {
      statusCode: 400,
      data: { error: { type: 'invalid_request_error', code: 'bad value!' } },
      requestBodyValues: { messages: 'SECRET prompt' }
    });
  const logged = (/** @type {() => void} */ run) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    run();
    const out = spy.mock.calls[0].join(' ');
    spy.mockRestore();
    return out;
  };

  it('always logs status and the provider type/code, never the message or request body', () => {
    const out = logged(() => streamErrorMessage(httpError()));
    expect(out).toContain('400');
    expect(out).toContain('invalid_request_error');
    expect(out).toContain('badvalue');
    expect(out).not.toContain('MARKER');
    expect(out).not.toContain('SECRET');
  });

  it('logs the capped one-line message only on the dev gate (TERMI_TRANSCRIPT_DIR set)', () => {
    const out = logged(() => streamErrorMessage(httpError(), true));
    expect(out).toContain('MARKER-user-text text content blocks must be non-empty');
    expect(out).not.toContain('SECRET');
    expect(out.length).toBeLessThan(450);
  });
});
