/**
 * CreateProfile after the user deleted their own kind 0 (NIP-09).
 *
 * Deleting a personal-key community deletes the kind 0 too. The store then
 * has no profile, so EditProfileModal picks CreateProfile — whose guard
 * re-reads kind 0 through the store's fallback loader. A relay that ignored
 * the deletion hands the old profile back, the loader passes it through
 * (EventStore.add returns deleted events instead of null), and applesauce's
 * guard threw "Profile already exists": the name could never be changed again.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { EventStore } from 'applesauce-core';
import { DeleteManager } from 'applesauce-core/event-store';
import { castUser } from 'applesauce-common/casts';
import { PrivateKeySigner } from 'applesauce-signers';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { of } from 'rxjs';

import { CreateProfile } from '../actions/profile-actions.js';

function setup() {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const deleteManager = new DeleteManager();
  const store = Object.assign(new EventStore({ deleteManager }), { deleteManager });

  const oldProfile = finalizeEvent(
    { kind: 0, created_at: 1000, tags: [], content: JSON.stringify({ name: 'Community' }) },
    sk
  );
  const deletion = finalizeEvent(
    { kind: 5, created_at: 2000, tags: [['a', `0:${pubkey}:`]], content: '' },
    sk
  );
  store.add(deletion);
  // A relay that kept the deleted profile answers the fallback lookup.
  store.eventLoader = () => of(/** @type {any} */ (store.add(oldProfile)));

  const published = /** @type {any[]} */ ([]);
  const ctx = {
    events: store,
    user: castUser(pubkey, store),
    signer: new PrivateKeySigner(sk),
    publish: vi.fn(async (/** @type {any} */ e) => {
      published.push(e);
    })
  };
  return { ctx, store, pubkey, published, sk };
}

describe('CreateProfile', () => {
  it('creates a new profile when the only one found was deleted by the user', async () => {
    const { ctx, published } = setup();
    await CreateProfile({ name: 'Paula GR' })(/** @type {any} */ (ctx));
    expect(published).toHaveLength(1);
    expect(published[0].kind).toBe(0);
    expect(JSON.parse(published[0].content).name).toBe('Paula GR');
  });

  it('still refuses to overwrite a live profile it finds on the relays', async () => {
    const { ctx, store, sk } = setup();
    const live = finalizeEvent(
      { kind: 0, created_at: 3000, tags: [], content: JSON.stringify({ name: 'Live' }) },
      sk
    );
    store.eventLoader = () => of(/** @type {any} */ (store.add(live)));
    await expect(CreateProfile({ name: 'x' })(/** @type {any} */ (ctx))).rejects.toThrow(
      'Profile already exists'
    );
  });
});
