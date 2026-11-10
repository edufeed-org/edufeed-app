/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { DRAFT_WRAP_KIND, unwrapDraft, wrapDraftTemplate } from '$lib/helpers/draft-wraps.js';

/** A real NIP-44 signer (self-encryption) over a fresh key. */
function realSigner() {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const key = (/** @type {string} */ pk) => nip44.getConversationKey(sk, pk);
  return {
    pubkey,
    nip44: {
      encrypt: async (/** @type {string} */ pk, /** @type {string} */ t) =>
        nip44.encrypt(t, key(pk)),
      decrypt: async (/** @type {string} */ pk, /** @type {string} */ c) =>
        nip44.decrypt(c, key(pk))
    }
  };
}

const draft = {
  kind: 30023,
  created_at: 1700000000,
  tags: [
    ['d', 'lesson-c1-lesson-2'],
    ['title', 'Stunde 2'],
    ['published_at', '1700000000'],
    ['summary', 'Kurz.'],
    ['client', 'Edufeed']
  ],
  content: '# Stunde 2\n\nText.'
};

describe('draft wraps (NIP-37)', () => {
  it('round trip: kind 31234, d + k tags, encrypted content, the draft back', async () => {
    const s = realSigner();
    const wrap = await wrapDraftTemplate(draft, s, s.pubkey);
    expect(wrap.kind).toBe(DRAFT_WRAP_KIND);
    expect(wrap.tags).toEqual([
      ['d', 'lesson-c1-lesson-2'],
      ['k', '30023']
    ]);
    expect(wrap.content).not.toContain('Stunde');
    expect(await unwrapDraft(wrap, s, s.pubkey)).toEqual(draft);
  });

  it('tampered content, another key, k mismatch, no d, no nip44 → null', async () => {
    const s = realSigner();
    const wrap = await wrapDraftTemplate(draft, s, s.pubkey);
    const flipped =
      wrap.content.slice(0, 20) + (wrap.content[20] === 'A' ? 'B' : 'A') + wrap.content.slice(21);
    expect(await unwrapDraft({ ...wrap, content: flipped }, s, s.pubkey)).toBeNull();
    const other = realSigner();
    expect(await unwrapDraft(wrap, other, other.pubkey)).toBeNull();
    expect(
      await unwrapDraft(
        {
          ...wrap,
          tags: [
            ['d', 'x'],
            ['k', '30024']
          ]
        },
        s,
        s.pubkey
      )
    ).toBeNull();
    expect(await unwrapDraft({ ...wrap, tags: [['k', '30023']] }, s, s.pubkey)).toBeNull();
    expect(await unwrapDraft(wrap, {}, s.pubkey)).toBeNull();
  });

  it('refuses to wrap when the signer hands back plaintext', async () => {
    const s = { nip44: { encrypt: async (/** @type {any} */ _p, /** @type {string} */ t) => t } };
    await expect(wrapDraftTemplate(draft, s, 'a'.repeat(64))).rejects.toThrow();
  });
});
