/** @vitest-environment node */
/**
 * Mentions in forum threads (11), articles (30023) and wiki pages (30818)
 * reach the inbox: they type as 'mention', name their surface for the row
 * copy, and link to the thread's nevent or the page's naddr.
 */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  getNotificationType,
  getNotificationUrl,
  getMentionSurface,
  getEventTitle
} from '../helpers/inbox.js';

const AUTHOR = 'a'.repeat(64);
/**
 * @param {number} kind
 * @param {string[][]} [tags]
 */
const ev = (kind, tags = []) => ({
  id: 'e'.repeat(64),
  kind,
  pubkey: AUTHOR,
  tags,
  content: '',
  created_at: 1,
  sig: ''
});

describe('mention surfaces', () => {
  it('types threads, articles and wikis as mentions and names the surface', () => {
    expect(getNotificationType(ev(11))).toBe('mention');
    expect(getNotificationType(ev(30023))).toBe('mention');
    expect(getNotificationType(ev(30818))).toBe('mention');
    expect(getMentionSurface(ev(1))).toBe('note');
    expect(getMentionSurface(ev(9))).toBe('community');
    expect(getMentionSurface(ev(11))).toBe('thread');
    expect(getMentionSurface(ev(30023))).toBe('article');
    expect(getMentionSurface(ev(30818))).toBe('wiki');
    expect(getMentionSurface(ev(7))).toBeNull();
  });

  it('links a thread to its nevent and an article/wiki to its naddr', () => {
    expect(getNotificationUrl(ev(11))).toBe(
      `/${nip19.neventEncode({ id: 'e'.repeat(64), relays: [] })}`
    );
    expect(getNotificationUrl(ev(30023, [['d', 'my-post']]))).toBe(
      `/${nip19.naddrEncode({ kind: 30023, pubkey: AUTHOR, identifier: 'my-post', relays: [] })}`
    );
    expect(getNotificationUrl(ev(30818, [['d', 'topic']]))).toBe(
      `/${nip19.naddrEncode({ kind: 30818, pubkey: AUTHOR, identifier: 'topic', relays: [] })}`
    );
  });

  it('reads the title tag, empty when missing', () => {
    expect(getEventTitle(ev(30023, [['title', 'Hello']]))).toBe('Hello');
    expect(getEventTitle(ev(30023))).toBe('');
  });
});
