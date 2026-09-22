/**
 * DM actions — NIP-30 custom emoji tags on the NIP-17 rumor.
 *
 * The DM composer inserts `:shortcode:` for a picked custom emoji, but the
 * stock applesauce `SendWrappedMessage` / `ReplyToWrappedMessage` actions
 * build the kind-14 rumor from plain text and never emit an `emoji` tag. The
 * renderer resolves shortcodes *only* from that tag, so the message showed
 * the literal `:dogedance_sm:` text (laoc, 2026-09-16). These local variants
 * take the picked emojis and tag the rumor the way the community chat does.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { SendWrappedMessage, ReplyToWrappedMessage } from '$lib/actions/dm-actions.js';
import { parseEventContent } from '$lib/helpers/nostrContent.js';
import { nip19 } from 'nostr-tools';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const DOGE = { shortcode: 'dogedance_sm', url: 'https://example.org/dogedance_sm.gif' };
const CAT = { shortcode: 'cat', url: 'https://example.org/cat.png' };

const signer = { getPublicKey: async () => ME };

/**
 * Run an action with a stub context and capture the rumor handed to `run`.
 * @param {import('applesauce-actions').Action} action
 * @returns {Promise<{ rumor: import('nostr-tools').Event, opts: any, builder: any }>}
 */
async function runAction(action) {
  /** @type {{ builder: any, args: any[] }[]} */
  const calls = [];
  /** @param {any} builder @param {any[]} args */
  const run = async (builder, ...args) => {
    calls.push({ builder, args });
  };
  await action(/** @type {any} */ ({ signer, run }));
  expect(calls).toHaveLength(1);
  return { rumor: calls[0].args[0], opts: calls[0].args[1], builder: calls[0].builder };
}

/** @param {{ tags: string[][] }} rumor */
const emojiTags = (rumor) => rumor.tags.filter((t) => t[0] === 'emoji');

describe('SendWrappedMessage (with custom emojis)', () => {
  it('tags a custom emoji whose shortcode appears in the content', async () => {
    const { rumor } = await runAction(
      SendWrappedMessage([ME, PEER], 'Guten Morgen! :dogedance_sm: gut geschlafen?', {
        emojis: [DOGE]
      })
    );

    expect(rumor.kind).toBe(14);
    expect(rumor.content).toBe('Guten Morgen! :dogedance_sm: gut geschlafen?');
    expect(emojiTags(rumor)).toEqual([['emoji', 'dogedance_sm', DOGE.url]]);
  });

  it('produces a rumor the content renderer turns into an emoji node', async () => {
    // End-to-end in-process: the same parser NostrContentRenderer uses must
    // now resolve the shortcode instead of leaving literal text.
    const { rumor } = await runAction(
      SendWrappedMessage([ME, PEER], 'hi :dogedance_sm:', { emojis: [DOGE] })
    );

    const nodes = parseEventContent(rumor).children.map((n) => n.type);
    expect(nodes).toContain('emoji');
  });

  it('keeps the participant p-tags and the stamped sender pubkey', async () => {
    const { rumor } = await runAction(SendWrappedMessage([ME, PEER], ':cat:', { emojis: [CAT] }));

    expect(rumor.pubkey).toBe(ME);
    expect(rumor.tags.filter((t) => t[0] === 'p').map((t) => t[1])).toEqual([ME, PEER]);
  });

  it('skips picked emojis the user deleted from the text again', async () => {
    const { rumor } = await runAction(
      SendWrappedMessage([ME, PEER], 'only :cat: here', { emojis: [DOGE, CAT] })
    );

    expect(emojiTags(rumor)).toEqual([['emoji', 'cat', CAT.url]]);
  });

  it('emits one tag per shortcode even when it is used twice', async () => {
    const { rumor } = await runAction(
      SendWrappedMessage([ME, PEER], ':cat: :cat:', { emojis: [CAT] })
    );

    expect(emojiTags(rumor)).toEqual([['emoji', 'cat', CAT.url]]);
  });

  it('adds no emoji tag when no custom emoji was picked', async () => {
    const { rumor } = await runAction(SendWrappedMessage([ME, PEER], 'plain :D'));

    expect(emojiTags(rumor)).toEqual([]);
  });

  it('hands the gift-wrap options through to the wrap step untouched', async () => {
    const { opts } = await runAction(
      SendWrappedMessage([ME, PEER], ':cat:', { emojis: [CAT], expiration: 123 })
    );

    expect(opts).toEqual({ expiration: 123 });
  });
});

describe('ReplyToWrappedMessage (with custom emojis)', () => {
  /** @type {import('applesauce-common/helpers/gift-wrap').Rumor} */
  const parent = {
    id: 'c'.repeat(64),
    kind: 14,
    pubkey: PEER,
    content: 'hi',
    created_at: 1_700_000_000,
    tags: [['p', ME]]
  };

  it('tags the custom emoji and keeps the reply threading', async () => {
    const { rumor } = await runAction(
      ReplyToWrappedMessage(parent, 'yes :dogedance_sm:', { emojis: [DOGE] })
    );

    expect(emojiTags(rumor)).toEqual([['emoji', 'dogedance_sm', DOGE.url]]);
    expect(rumor.tags.some((t) => t[0] === 'e' && t[1] === parent.id)).toBe(true);
  });
});

describe('mention-derived p-tags (issue: relay identity became a DM participant)', () => {
  // applesauce builds the kind-14 rumor with `setShortTextContent`, which
  // p-tags every pubkey behind a `nostr:` pointer in the body. A group invite
  // carries `nostr:naddr…` whose author is the relay's NIP-11 `self` key, so
  // the relay identity turned into a third conversation participant — shown
  // as a nameless hex sender — and even received its own gift-wrap copy.
  // NIP-17: the p-tags are the receivers, nothing else.
  const RELAY = 'd'.repeat(64);
  const THIRD = 'e'.repeat(64);
  const groupNaddr = nip19.naddrEncode({
    kind: 39000,
    pubkey: RELAY,
    identifier: 'abc123',
    relays: ['wss://groups.example.org']
  });
  const invite = `Du bist eingeladen.\nhttps://app.example/join\nnostr:${groupNaddr}?invite=hMX6PYy4m37J`;

  /** @param {{ tags: string[][] }} rumor */
  const pTags = (rumor) => rumor.tags.filter((t) => t[0] === 'p').map((t) => t[1]);

  it('does not p-tag the author of an naddr mentioned in the body', async () => {
    const { rumor } = await runAction(SendWrappedMessage([ME, PEER], invite));

    expect(pTags(rumor)).toEqual([ME, PEER]);
    expect(rumor.content).toContain(`nostr:${groupNaddr}?invite=`);
  });

  it('does not p-tag a third party mentioned via nostr:npub', async () => {
    const npub = nip19.npubEncode(THIRD);
    const { rumor } = await runAction(SendWrappedMessage([ME, PEER], `schau mal nostr:${npub}`));

    expect(pTags(rumor)).toEqual([ME, PEER]);
  });

  it('keeps a mentioned pubkey that is a participant anyway, once', async () => {
    const npub = nip19.npubEncode(PEER);
    const { rumor } = await runAction(SendWrappedMessage([ME, PEER], `hi nostr:${npub}`));

    expect(pTags(rumor)).toEqual([ME, PEER]);
  });

  it('accepts a single recipient string and still prunes mentions', async () => {
    const { rumor } = await runAction(SendWrappedMessage(PEER, invite));

    expect(pTags(rumor)).toEqual([PEER]);
  });

  it('keeps a reply addressed to the parent sender only', async () => {
    /** @type {import('applesauce-common/helpers/gift-wrap').Rumor} */
    const parent = {
      id: 'c'.repeat(64),
      kind: 14,
      pubkey: PEER,
      content: 'hi',
      created_at: 1_700_000_000,
      tags: [['p', ME]]
    };
    const { rumor } = await runAction(ReplyToWrappedMessage(parent, invite));

    expect(pTags(rumor)).toEqual([ME]);
    expect(rumor.tags.some((t) => t[0] === 'e' && t[1] === parent.id)).toBe(true);
  });
});
