// @ts-nocheck
/**
 * CallChatPanel parses every message once (links, emojis, mentions, preview
 * URLs) and keeps the result for as long as the message is on screen. The
 * parsed map is rebuilt whenever the chat or a profile changes, so the
 * expensive part is memoised per message: `reuseParsed` carries entries
 * over from the previous map while their key is unchanged.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { reuseParsed } from '$lib/groups/call-chat-parse.js';

const msg = (id, text) => ({ id, text });

describe('reuseParsed', () => {
  it('parses each message once across rebuilds', () => {
    const parse = vi.fn((c) => ({ upper: c.text.toUpperCase() }));
    const key = () => '';
    const first = reuseParsed(new Map(), [msg('a', 'x')], { key, parse });
    const second = reuseParsed(first, [msg('a', 'x'), msg('b', 'y')], { key, parse });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(second.get('a')).toBe(first.get('a'));
    expect(second.get('b')).toEqual({ upper: 'Y' });
  });

  it('parses a message again when its key changes', () => {
    const parse = vi.fn((c) => ({ upper: c.text.toUpperCase() }));
    let name = 'anon';
    const key = () => name;
    const first = reuseParsed(new Map(), [msg('a', 'x')], { key, parse });
    name = 'Ada';
    const second = reuseParsed(first, [msg('a', 'x')], { key, parse });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(second.get('a')).not.toBe(first.get('a'));
  });

  it('drops entries of messages that are gone', () => {
    const parse = (c) => ({ upper: c.text.toUpperCase() });
    const key = () => '';
    const first = reuseParsed(new Map(), [msg('a', 'x'), msg('b', 'y')], { key, parse });
    const second = reuseParsed(first, [msg('b', 'y')], { key, parse });
    expect([...second.keys()]).toEqual(['b']);
  });
});
