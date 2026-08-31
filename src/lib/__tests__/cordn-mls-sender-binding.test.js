/** @vitest-environment node */
// Sender identity binding (review finding, 2026-08-28): the envelope sender
// must come from the MLS sender's LEAF CREDENTIAL, never from the
// attacker-chosen authenticatedData. With AAD-derived identity, any group
// member could impersonate any pubkey — validateEnvelope only compared
// envelope.pubkey against the very AAD the attacker wrote.
import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  generateChatKeyPackage,
  decodeKeyPackagePair,
  createInitialGroupState,
  addMember,
  joinFromWelcome,
  createChatMessage,
  processOpaqueMessage
} from '$lib/cordn/mls.js';

/** Alice founds a group and adds Bob; both end on the same epoch. */
async function twoMemberGroup() {
  const alicePub = getPublicKey(generateSecretKey());
  const bobPub = getPublicKey(generateSecretKey());
  const alicePair = decodeKeyPackagePair(await generateChatKeyPackage(alicePub));
  const bobPair = decodeKeyPackagePair(await generateChatKeyPackage(bobPub));
  const aliceInitial = await createInitialGroupState(alicePair);
  const added = await addMember({ state: aliceInitial, memberKeyPackage: bobPair.keyPackage });
  const bobState = await joinFromWelcome({
    welcomeBase64: added.welcomeBase64,
    keyPackage: bobPair.keyPackage,
    privateKeyPackage: bobPair.privateKeyPackage
  });
  return { alicePub, bobPub, aliceState: added.newState, bobState };
}

describe('cordn MLS sender binding', () => {
  it('reports the honest sender from the leaf credential', async () => {
    const { bobPub, aliceState, bobState } = await twoMemberGroup();
    const sent = await createChatMessage({
      state: bobState,
      envelopeJson: '{"hello":1}',
      senderPubkey: bobPub
    });
    const processed = await processOpaqueMessage({
      state: aliceState,
      opaqueMessageBase64: sent.opaqueMessageBase64
    });
    expect(processed.kind).toBe('application');
    expect(/** @type {any} */ (processed).senderPubkey).toBe(bobPub);
  }, 30000);

  it('binds senderPubkey to the sending leaf even when the AAD claims another member', async () => {
    const { alicePub, bobPub, aliceState, bobState } = await twoMemberGroup();
    // Bob forges: AAD (and thus, downstream, envelope.pubkey checks) claims
    // to be Alice. The MLS layer knows the true sender leaf — that identity,
    // not the AAD, must come back out.
    const forged = await createChatMessage({
      state: bobState,
      envelopeJson: '{"content":"I resign as admin"}',
      senderPubkey: alicePub
    });
    const processed = await processOpaqueMessage({
      state: aliceState,
      opaqueMessageBase64: forged.opaqueMessageBase64
    });
    expect(processed.kind).toBe('application');
    expect(/** @type {any} */ (processed).senderPubkey).toBe(bobPub);
    expect(/** @type {any} */ (processed).senderPubkey).not.toBe(alicePub);
  }, 30000);
});
