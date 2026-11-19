/** @vitest-environment node */
// Termi feedback leaves the browser as one NIP-17 gift wrap to the support pubkey.
import { describe, it, expect, vi } from 'vitest';
import { PrivateKeySigner } from 'applesauce-signers';
import { unlockGiftWrap } from 'applesauce-common/helpers/gift-wrap';

vi.mock('$lib/services/gift-wrap-publish.js', () => ({ publishGiftWrap: vi.fn() }));

import {
  sendTermiFeedback,
  FEEDBACK_EXPIRY_SECONDS
} from '../components/assistant/feedback-send.js';

const NADDR =
  'naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsxu35yyt0mwjjh8pcz4zprhxegz69t4wr9t74vk6zne58wzh0waycrqsqqqa28';
const BODY = `Termi-Feedback 👎 — Sonstiges\n\nSiehe nostr:${NADDR} #thema\n\`\`\`json\n{"vote": "down"}\n\`\`\``;
const RELAYS = ['wss://dm.example'];
const NOW = 1_800_000_000;

async function setup() {
  const support = new PrivateKeySigner();
  const recipient = await support.getPublicKey();
  const publish = vi.fn(async () => ({ success: true, successCount: 1, relays: RELAYS }));
  const send = (/** @type {object} */ extra = {}) =>
    sendTermiFeedback(
      { body: BODY, recipient, relays: RELAYS, ...extra },
      { publish, now: () => NOW }
    );
  return { support, recipient, publish, send };
}

describe('sendTermiFeedback', () => {
  it('publishes one kind 1059 to exactly the given relays', async () => {
    const { publish, send } = await setup();
    await send();
    expect(publish).toHaveBeenCalledTimes(1);
    const [event, relays] = publish.mock.calls[0];
    expect(event.kind).toBe(1059);
    expect(relays).toEqual(RELAYS);
  });

  it('the wrap is tagged for the recipient and expires after 90 days', async () => {
    const { recipient, publish, send } = await setup();
    await send();
    const [event] = publish.mock.calls[0];
    expect(event.tags.filter((/** @type {string[]} */ t) => t[0] === 'p')).toEqual([
      ['p', recipient]
    ]);
    expect(FEEDBACK_EXPIRY_SECONDS).toBe(90 * 24 * 60 * 60);
    expect(event.tags.find((/** @type {string[]} */ t) => t[0] === 'expiration')?.[1]).toBe(
      String(NOW + FEEDBACK_EXPIRY_SECONDS)
    );
  });

  it('the recipient reads a kind 14 with the body unchanged, addressed only to them', async () => {
    const { support, recipient, publish, send } = await setup();
    await send();
    const rumor = await unlockGiftWrap(publish.mock.calls[0][0], support);
    expect(rumor.kind).toBe(14);
    expect(rumor.content).toBe(BODY);
    // a nostr: link in the text must not add its author as a receiver
    expect(rumor.tags.filter((t) => t[0] === 'p')).toEqual([['p', recipient]]);
  });

  it('unnamed: the sender is a one-time key, new for every message', async () => {
    const { support, publish, send } = await setup();
    await send();
    await send();
    const [a, b] = await Promise.all(publish.mock.calls.map(([e]) => unlockGiftWrap(e, support)));
    expect(a.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(a.pubkey).not.toBe(b.pubkey);
  });

  it('named: the sender is the user', async () => {
    const { support, publish, send } = await setup();
    const user = new PrivateKeySigner();
    await send({ signer: user });
    const rumor = await unlockGiftWrap(publish.mock.calls[0][0], support);
    expect(rumor.pubkey).toBe(await user.getPublicKey());
  });

  it('throws when no relay accepted it', async () => {
    const { publish, send } = await setup();
    publish.mockResolvedValueOnce({ success: false, successCount: 0, relays: RELAYS });
    await expect(send()).rejects.toThrow();
  });

  it('named with a signer that cannot encrypt: rejects, publishes nothing, no unnamed fallback', async () => {
    const { publish, send } = await setup();
    const user = new PrivateKeySigner();
    const broken = {
      getPublicKey: () => user.getPublicKey(),
      signEvent: (/** @type {any} */ e) => user.signEvent(e),
      nip44: {
        encrypt: async () => {
          throw new Error('signer said no');
        },
        decrypt: user.nip44.decrypt
      }
    };
    await expect(send({ signer: broken })).rejects.toThrow('signer said no');
    expect(publish).not.toHaveBeenCalled();
  });

  it('throws without relays and publishes nothing (never a fallback relay)', async () => {
    const { publish, send } = await setup();
    await expect(send({ relays: [] })).rejects.toThrow();
    expect(publish).not.toHaveBeenCalled();
  });
});
