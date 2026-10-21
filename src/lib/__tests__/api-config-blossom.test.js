/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';

const ALICE = 'a'.repeat(64);

describe('GET /api/config — blossom gate', () => {
  beforeEach(() => vi.resetModules());

  /** @param {Record<string, string>} env */
  async function body(env) {
    vi.doMock('$env/dynamic/private', () => ({ env }));
    const { GET } = await import('../../routes/api/config/+server.js');
    return GET().json();
  }

  it('defaults: gate off, primal as the public server', async () => {
    const cfg = await body({});
    expect(cfg.blossom.gated).toBe(false);
    expect(cfg.blossom.eligibleDomains).toEqual([]);
    expect(cfg.blossom.publicServers).toEqual(['https://blossom.primal.net']);
    expect(cfg.blossom.maxFileSize).toBe(5 * 1024 * 1024);
  });

  it('domains switch the gate on and are exposed for UI copy', async () => {
    const cfg = await body({
      BLOSSOM_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org, partner.example',
      PUBLIC_BLOSSOM_SERVERS: 'https://a.example,https://b.example'
    });
    expect(cfg.blossom.gated).toBe(true);
    expect(cfg.blossom.eligibleDomains).toEqual(['edufeed.org', 'partner.example']);
    expect(cfg.blossom.publicServers).toEqual(['https://a.example', 'https://b.example']);
  });

  it('a pubkey allowlist alone gates too but never leaks', async () => {
    const npub = nip19.npubEncode(ALICE);
    const cfg = await body({ BLOSSOM_ELIGIBLE_PUBKEYS: npub });
    expect(cfg.blossom.gated).toBe(true);
    const text = JSON.stringify(cfg);
    expect(text).not.toContain(ALICE);
    expect(text).not.toContain(npub);
  });
});
