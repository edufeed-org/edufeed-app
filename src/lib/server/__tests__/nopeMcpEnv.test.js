/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nopeMcpEnv } from '../nopeMcpEnv.js';

describe('nopeMcpEnv', () => {
  it('prefers the NOPE_MCP_* name when both are set', () => {
    const env = {
      NOPE_MCP_URL: 'https://nope.example/mcp',
      AMB_MCP_URL: 'https://amb.example/mcp'
    };
    expect(nopeMcpEnv(env, 'URL')).toBe('https://nope.example/mcp');
  });

  it('falls back to the legacy AMB_MCP_* name when NOPE_MCP_* is unset', () => {
    const env = { AMB_MCP_URL: 'https://amb.example/mcp' };
    expect(nopeMcpEnv(env, 'URL')).toBe('https://amb.example/mcp');
  });

  it('treats an empty string as unset and still falls back', () => {
    const env = { NOPE_MCP_URL: '', AMB_MCP_URL: 'https://amb.example/mcp' };
    expect(nopeMcpEnv(env, 'URL')).toBe('https://amb.example/mcp');
  });

  it('returns undefined when neither name is set', () => {
    /** @type {Record<string, string | undefined>} */
    const env = {};
    expect(nopeMcpEnv(env, 'URL')).toBeUndefined();
  });

  it('returns undefined when both names are empty strings', () => {
    const env = { NOPE_MCP_URL: '', AMB_MCP_URL: '' };
    expect(nopeMcpEnv(env, 'URL')).toBeUndefined();
  });

  it('works for any suffix, not just URL', () => {
    expect(nopeMcpEnv({ AMB_MCP_CLIENT_SECRET: 's3cret' }, 'CLIENT_SECRET')).toBe('s3cret');
    expect(nopeMcpEnv({ NOPE_MCP_SCOPE: 'mcp:extract' }, 'SCOPE')).toBe('mcp:extract');
  });
});
