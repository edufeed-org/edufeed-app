/**
 * Pins the WIRING of isValidRelayUrl inside parseGroupInput. The node-env
 * suite cannot exercise it through the real decodeGroupPointer — Node's URL
 * parser throws on the garbage that Chrome's lenient parser percent-encodes
 * into the host (TestOER, measured on :5180) — so this file mocks
 * decodeGroupPointer to speak the Chrome dialect for exactly that input.
 * Without the validator call inside parseGroupInput, the first test goes
 * green-vacuous in node and the browser regression comes back unseen.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('applesauce-common/helpers/groups', async (importOriginal) => {
  const actual = /** @type {Record<string, any>} */ (await importOriginal());
  return {
    ...actual,
    /** @param {string} input */
    decodeGroupPointer: (input) =>
      input === 'not a pointer'
        ? // Verbatim Chrome output: forbidden host bytes percent-encoded,
          // no throw.
          { relay: 'wss://not%20a%20pointer/', id: '' }
        : actual.decodeGroupPointer(input)
  };
});

const { parseGroupInput } = await import('$lib/groups/groups.js');

describe('parseGroupInput under a Chrome-dialect URL parser', () => {
  it('rejects garbage even when decodeGroupPointer does not throw', () => {
    expect(parseGroupInput('not a pointer')).toBeNull();
  });

  it('control: real pointers pass through the mock unchanged', () => {
    expect(parseGroupInput("groups.example.com'beechat")).toEqual({
      relay: 'wss://groups.example.com/',
      id: 'beechat'
    });
  });
});
