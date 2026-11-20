/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { createCatalog } from '../termi/models.js';

const env = {
  TERMI_LLM_BASE_URL: 'https://saia.example/v1',
  TERMI_LLM_API_KEY: 'k',
  TERMI_LLM_MODELS: 'glm-5.3,glm-5.3-flash',
  TERMI_EXTERNAL_MODELS: 'claude-sonnet-5-5',
  TERMI_ANTHROPIC_API_KEY: 'a'
};
const A = 'anthropic:claude-sonnet-5-5';

describe('createCatalog', () => {
  it('lists SAIA ids prefixed, default first', () => {
    const c = createCatalog(env);
    expect(c.saia).toEqual(['saia:glm-5.3', 'saia:glm-5.3-flash']);
    expect(c.defaultId).toBe('saia:glm-5.3');
    expect(c.external).toEqual([A]);
    expect(c.externalEnabled).toBe(true);
  });
  it('falls back to TERMI_LLM_MODEL and drops external-looking ids', () => {
    expect(
      createCatalog({ ...env, TERMI_LLM_MODELS: undefined, TERMI_LLM_MODEL: 'glm-5.3' }).saia
    ).toEqual(['saia:glm-5.3']);
    expect(createCatalog({ ...env, TERMI_LLM_MODELS: 'gpt-5,o3,claude-x,glm-5.3' }).saia).toEqual([
      'saia:glm-5.3'
    ]);
  });
  it('resolves default, SAIA with fallbacks, unknown', () => {
    const c = createCatalog(env);
    expect(c.resolve(undefined, { listed: false })).toEqual({
      ok: true,
      id: 'saia:glm-5.3',
      candidates: ['saia:glm-5.3', 'saia:glm-5.3-flash']
    });
    expect(c.resolve('saia:glm-5.3-flash', { listed: false })).toMatchObject({
      ok: true,
      candidates: ['saia:glm-5.3-flash', 'saia:glm-5.3']
    });
    expect(c.resolve('saia:not-on-list', { listed: false })).toEqual({
      ok: false,
      status: 400,
      error: 'invalid_model'
    });
    expect(c.resolve('junk', { listed: true })).toMatchObject({ ok: false, status: 400 });
  });
  it('Anthropic needs the flag, the key, the list and a listed signer', () => {
    const c = createCatalog(env);
    expect(c.resolve(A, { listed: false })).toEqual({
      ok: false,
      status: 403,
      error: 'model_not_allowed'
    });
    expect(c.resolve(A, { listed: true })).toEqual({ ok: true, id: A, candidates: [A] });
    expect(
      createCatalog({ ...env, TERMI_ANTHROPIC_API_KEY: '' }).resolve(A, { listed: true })
    ).toMatchObject({ ok: false, status: 403 });
    expect(c.resolve('anthropic:claude-other', { listed: true })).toMatchObject({
      ok: false,
      status: 403
    });
  });
  it('builds models', () => {
    const c = createCatalog(env);
    expect(/** @type {any} */ (c.model('saia:glm-5.3')).modelId).toBe('glm-5.3');
    expect(/** @type {any} */ (c.model(A)).provider).toMatch(/anthropic/);
  });
});
