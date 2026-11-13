/** @vitest-environment node */
// Ported from edufeed-chat-bot src/lib/llm/compact-history.test.ts (Unlicense).
import { describe, it, expect } from 'vitest';
import { compactHistory } from '../termi/compact-history.js';

/** @typedef {import('ai').UIMessage} UIMessage */

/** @param {string} id @param {UIMessage['role']} role @param {string} text @returns {UIMessage} */
function textMsg(id, role, text) {
  return { id, role, parts: [{ type: 'text', text }] };
}

/** @param {string} id @param {UIMessage['role']} role @param {unknown} input @param {unknown} output @returns {UIMessage} */
function dynamicToolMsg(id, role, input, output) {
  return /** @type {UIMessage} */ ({
    id,
    role,
    parts: [
      {
        type: 'dynamic-tool',
        toolName: 'fetch_url',
        toolCallId: `call-${id}`,
        state: 'output-available',
        input,
        output
      }
    ]
  });
}

/** @param {string} id @param {UIMessage['role']} role @param {string} toolType @param {unknown} input @param {unknown} output @returns {UIMessage} */
function staticToolMsg(id, role, toolType, input, output) {
  return /** @type {UIMessage} */ (
    /** @type {unknown} */ ({
      id,
      role,
      parts: [
        { type: toolType, toolCallId: `call-${id}`, state: 'output-available', input, output }
      ]
    })
  );
}

/** @param {UIMessage} msg @returns {any} */
const part0 = (msg) => msg.parts[0];

const BIG = 'A'.repeat(10_000); // > 5_000 char threshold

describe('compactHistory', () => {
  it('returns text-only history unchanged', () => {
    const messages = [
      textMsg('1', 'user', 'hello'),
      textMsg('2', 'assistant', 'hi back'),
      textMsg('3', 'user', 'how are you?')
    ];
    expect(compactHistory(messages)).toEqual(messages);
  });

  it('does not mutate the input array or its messages', () => {
    const messages = [
      dynamicToolMsg('1', 'assistant', { html: BIG }, { text: BIG }),
      textMsg('2', 'user', 'follow up')
    ];
    const snapshot = JSON.parse(JSON.stringify(messages));
    compactHistory(messages);
    expect(messages).toEqual(snapshot);
  });

  it('replaces large input on dynamic-tool parts in messages older than last user turn', () => {
    const messages = [
      textMsg('1', 'user', 'fetch big page'),
      dynamicToolMsg('2', 'assistant', { html: BIG }, { ok: true }),
      textMsg('3', 'user', 'now what?')
    ];
    const part = part0(compactHistory(messages)[1]);
    expect(part.input._omitted).toBe(true);
    expect(part.input._original_chars).toBeGreaterThan(5_000);
  });

  it('replaces large output on dynamic-tool parts in messages older than last user turn', () => {
    const messages = [
      textMsg('1', 'user', 'fetch big page'),
      dynamicToolMsg('2', 'assistant', { url: 'https://x' }, { html: BIG, text: BIG }),
      textMsg('3', 'user', 'now what?')
    ];
    const part = part0(compactHistory(messages)[1]);
    expect(part.output._omitted).toBe(true);
    expect(part.output._original_chars).toBeGreaterThan(5_000);
  });

  it('preserves small tool inputs and outputs', () => {
    const small = { url: 'https://x' };
    const messages = [
      textMsg('1', 'user', 'small fetch'),
      dynamicToolMsg('2', 'assistant', small, { ok: true }),
      textMsg('3', 'user', 'next')
    ];
    const part = part0(compactHistory(messages)[1]);
    expect(part.input).toEqual(small);
    expect(part.output).toEqual({ ok: true });
  });

  it('preserves tool parts at or after the last user turn (current turn untouched)', () => {
    const messages = [
      textMsg('1', 'user', 'first turn'),
      textMsg('2', 'assistant', 'ok'),
      textMsg('3', 'user', 'now fetch'),
      dynamicToolMsg('4', 'assistant', { html: BIG }, { text: BIG })
    ];
    const part = part0(compactHistory(messages)[3]);
    expect(part.input.html.length).toBe(BIG.length);
    expect(part.output.text.length).toBe(BIG.length);
  });

  it('also compacts static "tool-{name}" parts (AI SDK v6 typed tool parts)', () => {
    const messages = [
      textMsg('1', 'user', 'fetch'),
      staticToolMsg('2', 'assistant', 'tool-fetch_url', { html: BIG }, { text: BIG }),
      textMsg('3', 'user', 'follow up')
    ];
    const part = part0(compactHistory(messages)[1]);
    expect(part.input._omitted).toBe(true);
    expect(part.output._omitted).toBe(true);
  });

  it('leaves text parts untouched even on older messages', () => {
    const longText = 'B'.repeat(50_000);
    const messages = [
      textMsg('1', 'user', 'first'),
      textMsg('2', 'assistant', longText),
      textMsg('3', 'user', 'second')
    ];
    const part = part0(compactHistory(messages)[1]);
    expect(part.type).toBe('text');
    expect(part.text).toBe(longText);
  });

  it('handles history with no user messages by leaving everything untouched', () => {
    const messages = [dynamicToolMsg('1', 'assistant', { html: BIG }, { text: BIG })];
    const part = part0(compactHistory(messages)[0]);
    expect(part.input.html.length).toBe(BIG.length);
  });
});

describe('compactHistory — thinking parts and provider metadata', () => {
  /** @returns {UIMessage[]} */
  const history = () =>
    /** @type {any} */ ([
      textMsg('u1', 'user', 'hallo'),
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'reasoning',
            text: 'MARKER-think',
            providerMetadata: { anthropic: { signature: 's' } }
          },
          { type: 'reasoning-file', file: { mediaType: 'image/png' } },
          { type: 'text', text: 'Antwort', providerMetadata: { anthropic: { cache: 1 } } },
          {
            type: 'tool-search_content',
            toolCallId: 'c1',
            state: 'output-available',
            input: { query: 'Bruch' },
            output: { items: [] },
            callProviderMetadata: { anthropic: { x: 1 } },
            resultProviderMetadata: { anthropic: { y: 1 } }
          }
        ]
      },
      {
        id: 'u2',
        role: 'user',
        parts: [{ type: 'text', text: 'mehr', providerMetadata: { openai: { z: 1 } } }]
      },
      {
        id: 'a2',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'MARKER-current' },
          { type: 'text', text: 'ok' }
        ]
      }
    ]);

  it('drops reasoning and reasoning-file parts on every turn, the current one too', () => {
    const out = compactHistory(history());
    const sent = JSON.stringify(out);
    expect(sent).not.toContain('reasoning');
    expect(sent).not.toContain('MARKER');
    expect(out[3].parts).toEqual([{ type: 'text', text: 'ok' }]);
  });

  it('strips provider metadata and keeps what the tool replay needs', () => {
    const out = /** @type {any} */ (compactHistory(history()));
    expect(JSON.stringify(out)).not.toMatch(/ProviderMetadata|providerMetadata/);
    expect(out[1].parts).toEqual([
      { type: 'text', text: 'Antwort' },
      {
        type: 'tool-search_content',
        toolCallId: 'c1',
        state: 'output-available',
        input: { query: 'Bruch' },
        output: { items: [] }
      }
    ]);
    expect(out[2].parts).toEqual([{ type: 'text', text: 'mehr' }]);
  });

  it('never mutates the input', () => {
    const input = history();
    const copy = structuredClone(input);
    compactHistory(input);
    expect(input).toEqual(copy);
  });
});
