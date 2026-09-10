/** @vitest-environment jsdom */
/**
 * createOwnedSlot — a single-occupant registry where releasing is scoped to
 * the claimant. The root layout hands these out through context so a page
 * or child layout can publish chrome data (ContentNavSidebar props, "I own
 * the bottom UI", ...). The failure this guards: Svelte's {#key} block mounts
 * the NEW branch before it destroys the OLD one, so an unconditional
 * `set(undefined)` in the old branch's teardown wiped the new branch's
 * registration — the sidebar vanished on every account-switch remount.
 */
import { describe, it, expect } from 'vitest';
import { createOwnedSlot } from '$lib/helpers/owned-slot.svelte.js';

describe('createOwnedSlot', () => {
  it('starts empty and exposes the claimed value', () => {
    const slot = createOwnedSlot();
    expect(slot.value).toBeUndefined();
    const getter = () => 'a';
    slot.claim(getter);
    expect(slot.value).toBe(getter);
  });

  it('release clears the slot when the claimant still owns it', () => {
    const slot = createOwnedSlot();
    const release = slot.claim(() => 'a');
    release();
    expect(slot.value).toBeUndefined();
  });

  it('a stale release does not clobber a newer claim (key-block remount order)', () => {
    const slot = createOwnedSlot();
    const releaseOld = slot.claim(() => 'old');
    const next = () => 'new';
    slot.claim(next);
    // Old branch torn down AFTER the new one registered.
    releaseOld();
    expect(slot.value).toBe(next);
  });

  it('release is idempotent', () => {
    const slot = createOwnedSlot();
    const release = slot.claim(() => 'a');
    release();
    const next = () => 'b';
    slot.claim(next);
    release();
    expect(slot.value).toBe(next);
  });
});
