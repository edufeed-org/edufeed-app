/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { stackedMessageIds } from '$lib/helpers/message-utils.js';

/** @param {string} id @param {string} pubkey @param {number} created_at */
const msg = (id, pubkey, created_at) => ({ type: 'message', message: { id, pubkey, created_at } });
const sep = { type: 'separator', date: 'x' };

describe('stackedMessageIds', () => {
  it('stacks a message under the previous one of the same sender within five minutes', () => {
    const ids = stackedMessageIds([
      sep,
      msg('a1', 'A', 1000),
      msg('a2', 'A', 1100),
      msg('b1', 'B', 1150),
      msg('a3', 'A', 1200),
      msg('a4', 'A', 1200 + 301),
      sep,
      msg('a5', 'A', 1200 + 310)
    ]);
    expect([...ids]).toEqual(['a2']);
  });

  it('is empty for no items', () => {
    expect(stackedMessageIds([]).size).toBe(0);
  });
});
