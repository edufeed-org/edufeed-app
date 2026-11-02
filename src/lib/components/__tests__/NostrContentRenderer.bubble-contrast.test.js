/**
 * Inside a primary chat bubble (your own messages) the renderer flips its
 * primary-colored text to the on-primary foreground. @mentions render through
 * UserProfilePreview with `text-info`, which the flip did not cover: on the
 * teal bubble the light info blue was unreadable (issue 933ba08f). Svelte's
 * scoped styles do not reach jsdom's cascade, so this guards the rule at the
 * source: every color class the renderer's subtree uses on text must be in
 * the flip, and the preview-surface exception must restore it.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const read = (/** @type {string} */ rel) => readFileSync(resolve(here, '..', rel), 'utf8');

function cssOf(/** @type {string} */ source) {
  return source.slice(source.indexOf('<style>'), source.indexOf('</style>'));
}

describe('NostrContentRenderer inside chat-bubble-primary', () => {
  const css = cssOf(read('shared/NostrContentRenderer.svelte'));

  it('flips text-primary, link-primary and text-info to the on-primary foreground', () => {
    const flip = css.slice(0, css.indexOf('.nostr-preview-surface'));
    for (const cls of ['.link-primary', '.text-primary', '.text-info']) {
      expect(flip).toContain(`:global(.chat-bubble-primary ${cls})`);
    }
    expect(flip).toContain('color: var(--color-primary-content)');
  });

  it('restores the normal colors inside embedded preview cards', () => {
    expect(css).toContain(':global(.chat-bubble-primary .nostr-preview-surface .text-info)');
    expect(css).toContain('color: var(--color-info)');
  });

  it('covers the color class the inline @mention actually uses', () => {
    const mention = read('shared/NostrPreviews/UserProfilePreview.svelte');
    const classes = [...mention.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
    const colorClasses = classes.filter((c) =>
      /^(text|link)-(primary|info|accent|secondary)$/.test(c)
    );
    expect(colorClasses.length).toBeGreaterThan(0);
    for (const cls of new Set(colorClasses)) {
      expect(css).toContain(`:global(.chat-bubble-primary .${cls})`);
    }
  });
});
