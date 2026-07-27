/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { sendChannelMessage } from '$lib/concord/send-message.js';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function fakeCommunity() {
  return {
    sendMessage: vi.fn(async (_channelId, _text) => {}),
    sendEvent: vi.fn(async (_channelId, _source) => {})
  };
}

describe('sendChannelMessage', () => {
  it('delegates non-replies to sendMessage unchanged', async () => {
    const community = fakeCommunity();
    await sendChannelMessage(community, 'chid', 'hello', null, ME);
    expect(community.sendMessage).toHaveBeenCalledWith('chid', 'hello');
    expect(community.sendEvent).not.toHaveBeenCalled();
  });

  it('replies go through sendEvent with q tag AND mention p tag for the parent author', async () => {
    const community = fakeCommunity();
    await sendChannelMessage(
      community,
      'chid',
      'reply text',
      { id: 'parent-id', author: OTHER },
      ME
    );
    expect(community.sendMessage).not.toHaveBeenCalled();
    expect(community.sendEvent).toHaveBeenCalledTimes(1);
    const [channelId, source] = community.sendEvent.mock.calls[0];
    expect(channelId).toBe('chid');
    const template = /** @type {any} */ (await source); // EventFactory is PromiseLike
    expect(template.kind).toBe(9);
    expect(template.content).toBe('reply text');
    const qTag = template.tags.find((/** @type {any} */ t) => t[0] === 'q');
    expect(qTag?.[1]).toBe('parent-id');
    const pTags = template.tags
      .filter((/** @type {any} */ t) => t[0] === 'p')
      .map((/** @type {any} */ t) => t[1]);
    expect(pTags).toContain(OTHER);
  });

  it('self-replies get the q tag but NO self p tag', async () => {
    const community = fakeCommunity();
    await sendChannelMessage(
      community,
      'chid',
      'note to self',
      { id: 'parent-id', author: ME },
      ME
    );
    const [, source] = community.sendEvent.mock.calls[0];
    const template = /** @type {any} */ (await source);
    expect(template.tags.find((/** @type {any} */ t) => t[0] === 'q')?.[1]).toBe('parent-id');
    expect(template.tags.filter((/** @type {any} */ t) => t[0] === 'p')).toHaveLength(0);
  });
});
