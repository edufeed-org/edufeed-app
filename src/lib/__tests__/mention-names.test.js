/** @vitest-environment jsdom */
/**
 * mentionNames — Svelte action that turns the truncated-npub links the
 * markdown/djot pipelines emit for `nostr:npub…` into `@Name` once the
 * profile arrives. Author-written link text is left alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';

const subs = vi.hoisted(() => ({
  /** @type {Map<string, (p: any) => void>} */
  callbacks: new Map(),
  unsubscribed: 0
}));
vi.mock('$lib/stores/profile-subscription.js', () => ({
  subscribeProfile: (/** @type {string} */ pubkey, /** @type {(p: any) => void} */ cb) => {
    subs.callbacks.set(pubkey, cb);
    return {
      unsubscribe: () => {
        subs.unsubscribed++;
      }
    };
  }
}));

import { mentionNames } from '$lib/helpers/mention-names.js';

const ALICE = 'a'.repeat(64);
const npub = nip19.npubEncode(ALICE);
const truncated = `${npub.slice(0, 10)}…${npub.slice(-3)}`;

describe('mentionNames action', () => {
  beforeEach(() => {
    subs.callbacks.clear();
    subs.unsubscribed = 0;
  });

  it('rewrites truncated npub links to @Name when the profile arrives, once per pubkey', () => {
    const node = document.createElement('div');
    node.innerHTML = `<p>hi <a href="/${npub}">${truncated}</a> and <a href="/${npub}">${truncated}</a></p>`;
    const action = mentionNames(node);
    expect(subs.callbacks.size).toBe(1);
    subs.callbacks.get(ALICE)?.({ name: 'alice', display_name: 'Alice' });
    const links = node.querySelectorAll('a');
    expect(links[0].textContent).toBe('@Alice');
    expect(links[1].textContent).toBe('@Alice');
    action.destroy();
    expect(subs.unsubscribed).toBe(1);
  });

  it('leaves authored link text alone and ignores non-profile links', () => {
    const node = document.createElement('div');
    node.innerHTML = `<a href="/${npub}">my friend</a><a href="/note1abc">note1abc</a><a href="/npub1bad">npub1bad</a>`;
    mentionNames(node);
    // nothing to resolve: the authored label stays, the other two are not profile links
    expect(subs.callbacks.size).toBe(0);
    expect(node.querySelector('a')?.textContent).toBe('my friend');
  });

  it('re-applies an already known name when the host replaces its HTML again (no second callback)', async () => {
    const node = document.createElement('div');
    node.innerHTML = `<a href="/${npub}">${truncated}</a>`;
    const action = mentionNames(node);
    subs.callbacks.get(ALICE)?.({ name: 'alice', display_name: 'Alice' });
    expect(node.querySelector('a')?.textContent).toBe('@Alice');
    // e.g. HighlightOverlay re-renders on every highlights emission
    node.innerHTML = `<p><a href="/${npub}">${truncated}</a> again</p>`;
    await new Promise((r) => setTimeout(r, 0));
    expect(node.querySelector('a')?.textContent).toBe('@Alice');
    expect(subs.callbacks.size).toBe(1); // still one subscription per pubkey
    action.destroy();
  });

  it('wires links added later (innerHTML replaced by the host)', async () => {
    const node = document.createElement('div');
    const action = mentionNames(node);
    node.innerHTML = `<a href="/${npub}">${truncated}</a>`;
    await new Promise((r) => setTimeout(r, 0));
    subs.callbacks.get(ALICE)?.({ name: 'alice' });
    expect(node.querySelector('a')?.textContent).toBe('@alice');
    action.destroy();
  });
});
