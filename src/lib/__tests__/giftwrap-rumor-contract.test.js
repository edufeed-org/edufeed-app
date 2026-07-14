/** @vitest-environment node */
/**
 * Contract test: locally-created gift wraps expose their rumor synchronously.
 *
 * This is the load-bearing assumption that lets DM send work optimistically
 * without a separate "pending message" reconciliation layer.
 *
 * When ActionRunner saves a locally-created gift wrap to the EventStore,
 * WrappedMessagesGroup → getGiftWrapRumor(gift) must return the rumor
 * without triggering decryption. If applesauce ever changes that contract,
 * this test fails before users notice doubled messages or missing optimistic
 * UI.
 */
import { describe, it, expect } from 'vitest';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { GiftWrapFactory, WrappedMessageFactory } from 'applesauce-common/factories';
import { getGiftWrapRumor, isGiftWrapUnlocked } from 'applesauce-common/helpers/gift-wrap';
import { kinds } from 'nostr-tools';

describe('gift wrap rumor contract', () => {
  it('locally-created gift wrap returns rumor synchronously via getGiftWrapRumor', async () => {
    const sender = new PrivateKeySigner();
    const recipient = new PrivateKeySigner();
    const senderPubkey = await sender.getPublicKey();
    const recipientPubkey = await recipient.getPublicKey();

    // Step 1: build the rumor (kind 14) the same way SendWrappedMessage does
    const rumor = await WrappedMessageFactory.create([senderPubkey, recipientPubkey], 'hello world')
      .as(sender)
      .stamp();

    // Step 2: gift-wrap the rumor for the sender themselves (the wrap that
    // WrappedMessagesGroup picks up via "#p":[self] when the sender views
    // their own conversation).
    const gift = await GiftWrapFactory.create(sender, senderPubkey, rumor);

    // Sanity: the gift wrap is a kind-1059 event tagged for `self`.
    expect(gift.kind).toBe(kinds.GiftWrap);
    expect(gift.tags.find((t) => t[0] === 'p')?.[1]).toBe(senderPubkey);
    expect(typeof gift.content).toBe('string');
    expect(gift.content.length).toBeGreaterThan(0);

    // The contract: no decryption call needed — the rumor is reachable
    // synchronously via the symbol references attached at creation time.
    expect(isGiftWrapUnlocked(gift)).toBe(true);

    const recovered = getGiftWrapRumor(gift);
    expect(recovered).toBeDefined();
    expect(recovered?.kind).toBe(kinds.PrivateDirectMessage);
    expect(recovered?.pubkey).toBe(senderPubkey);
    expect(recovered?.content).toBe('hello world');
    // p-tags on the rumor name both participants
    const pTags = recovered?.tags.filter((t) => t[0] === 'p').map((t) => t[1]) ?? [];
    expect(pTags).toContain(recipientPubkey);
  });
});
