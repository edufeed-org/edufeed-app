/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('/api/config moderation block', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  /** @param {Record<string, string>} env */
  const load = async (env) => {
    vi.doMock('$env/dynamic/private', () => ({ env }));
    const { GET } = await import('../../routes/api/config/+server.js');
    return (await GET().json()).moderation;
  };

  it('ships the known spam campaign as the default muted word', async () => {
    expect(await load({})).toEqual({ mutedWords: ['damus airdrop'] });
  });

  it('MUTED_WORDS replaces the default, lowercased, trimmed and deduped', async () => {
    expect(await load({ MUTED_WORDS: ' Damus Airdrop, free SATS ,damus airdrop' })).toEqual({
      mutedWords: ['damus airdrop', 'free sats']
    });
  });

  it('MUTED_WORDS=none disables the instance list', async () => {
    expect(await load({ MUTED_WORDS: 'none' })).toEqual({ mutedWords: [] });
  });

  it('an empty MUTED_WORDS keeps the default (unset and blank read the same)', async () => {
    expect(await load({ MUTED_WORDS: '' })).toEqual({ mutedWords: ['damus airdrop'] });
  });
});
