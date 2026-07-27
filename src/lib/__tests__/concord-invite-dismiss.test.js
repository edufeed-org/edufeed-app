/** @vitest-environment node */
// Regression test for the Task 11 review Critical: InviteWatcher.dismiss()
// keys its dismissed-set by the OUTER kind-1059 wrap id (`record.wrap.id` in
// recompute()), and resolveWrap() returns any non-string argument as-is — so
// dismissing with the decrypted kind-3313 rumor adds a never-matching id and
// the invite never leaves invites$ (Decline visibly does nothing; accepted
// invites reappear on reopen). resolveInviteWrap() must recover the wrap via
// the gift-wrap Symbol backlinks the watcher's own decrypt() populates.
//
// This drives the REAL dist InviteWatcher end-to-end with real crypto — a
// genuine Direct Invite wrap built by DirectInviteFactory, ingested and
// decrypted by the watcher — and observes invites$ shrinking, per the review
// instruction ("verified by observing that the invite disappears from the
// filtered list, not by assumption").
import { describe, it, expect } from 'vitest';
import { BehaviorSubject } from 'rxjs';
// eslint-disable-next-line no-restricted-imports -- this test deliberately exercises the real dist watcher, not the $lib/concord wrapper
import { InviteWatcher, Helpers, Factories } from 'applesauce-concord';
import { SimpleSigner } from 'applesauce-signers';
import { resolveInviteWrap } from '$lib/concord/invite-helpers.js';

/** In-memory ConcordStorage, so dismiss() persistence needs no localStorage. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: async (/** @type {string} */ k) => map.get(k) ?? null,
    setItem: async (/** @type {string} */ k, /** @type {string} */ v) => void map.set(k, v),
    removeItem: async (/** @type {string} */ k) => void map.delete(k)
  };
}

/** Builds a real Direct Invite wrap (owner → member) and a watcher for the member. */
async function setupWatcherWithInvite() {
  const owner = new SimpleSigner();
  const member = new SimpleSigner();
  const memberPk = await member.getPublicKey();
  const { material } = await Helpers.createCommunity({
    ownerPubkey: await owner.getPublicKey(),
    name: 'Test community',
    description: '',
    relays: ['wss://relay.example.com/']
  });
  const bundle = Helpers.buildInviteBundle(material, {});
  const wrap = await Factories.DirectInviteFactory.create(bundle, memberPk, owner);
  const watcher = new InviteWatcher({
    signer: member,
    // Never started — the pool is only touched by start()/refresh(); the
    // constructor just pipes status$ (lazily) into needsAuth$.
    pool: /** @type {any} */ ({ status$: new BehaviorSubject({}) }),
    storage: memoryStorage()
  });
  await watcher.ingest(wrap);
  return { watcher, wrap };
}

describe('InviteWatcher dismissal — wrap id vs rumor id (review Critical)', () => {
  it('decrypts a real Direct Invite into invites$, whose rumor id differs from the wrap id', async () => {
    const { watcher, wrap } = await setupWatcherWithInvite();
    expect(watcher.pending$.value.map((w) => w.id)).toContain(wrap.id);

    const unlocked = await watcher.readPending();
    expect(unlocked).toHaveLength(1);
    expect(watcher.invites$.value).toHaveLength(1);
    // The premise of the bug: the decrypted rumor's id is NOT the wrap's id.
    expect(watcher.invites$.value[0].rumor.id).not.toBe(wrap.id);
  });

  it('dismissing by the RUMOR is a silent no-op (the bug the fix avoids)', async () => {
    const { watcher } = await setupWatcherWithInvite();
    await watcher.readPending();
    const invite = watcher.invites$.value[0];

    // Cast: dismiss()'s type wants a signed NostrEvent — a rumor isn't one,
    // which is itself a hint this call shape was wrong. We test it anyway to
    // pin the runtime behavior the fix guards against.
    await watcher.dismiss(/** @type {any} */ (invite.rumor));
    // Still there — the rumor id never matches record.wrap.id in recompute().
    expect(watcher.invites$.value).toHaveLength(1);
  });

  it('resolveInviteWrap() recovers the outer wrap; dismissing THAT removes the invite from invites$', async () => {
    const { watcher, wrap } = await setupWatcherWithInvite();
    await watcher.readPending();
    const invite = watcher.invites$.value[0];

    const resolved = resolveInviteWrap(invite);
    expect(resolved?.id).toBe(wrap.id);

    await watcher.dismiss(resolved);
    expect(watcher.invites$.value).toHaveLength(0);
    expect(watcher.pending$.value).toHaveLength(0);
    expect(watcher.isDismissed(wrap)).toBe(true);
  });
});
