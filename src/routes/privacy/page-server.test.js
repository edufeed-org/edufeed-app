/** @vitest-environment node */
// /privacy answers 404 when the deployment ships no policy (the links are
// hidden then too) and otherwise hands the rendered HTML to the page.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoad = vi.hoisted(() => ({ policy: /** @type {any} */ (null) }));

vi.mock('$lib/server/privacy-policy.js', () => ({
  loadPrivacyPolicy: async () => mockLoad.policy
}));

describe('GET /privacy', () => {
  beforeEach(() => {
    mockLoad.policy = null;
  });

  it('404s when no policy is configured', async () => {
    const { load } = await import('./+page.server.js');
    await expect(load(/** @type {any} */ ({}))).rejects.toMatchObject({ status: 404 });
  });

  it('returns the rendered HTML', async () => {
    mockLoad.policy = { html: '<h1>Datenschutzerklärung</h1>' };
    const { load } = await import('./+page.server.js');
    const data = await load(/** @type {any} */ ({}));
    expect(data).toEqual({ html: '<h1>Datenschutzerklärung</h1>' });
  });
});
