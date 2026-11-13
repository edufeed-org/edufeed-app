/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  streamText,
  tool,
  isStepCount,
  jsonSchema,
  APICallError,
  simulateReadableStream
} from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { withFallback, createCooldown } from '../termi/fallback-model.js';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
};

/** @param {string} id @param {string} text */
const textChunks = (id, text) => [
  { type: 'stream-start', warnings: [] },
  { type: 'response-metadata', id: `r-${id}`, modelId: id, timestamp: new Date(0) },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: text },
  { type: 'text-end', id: 't1' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }
];

/** @param {string} id @param {string} text */
const answering = (id, text) =>
  new MockLanguageModelV4({
    modelId: id,
    doStream: async () => ({ stream: simulateReadableStream({ chunks: textChunks(id, text) }) })
  });

/** @param {number} statusCode @param {string} [message] */
const apiError = (statusCode, message = `HTTP ${statusCode}`) =>
  new APICallError({
    message,
    url: 'http://x',
    requestBodyValues: {},
    statusCode,
    isRetryable: false
  });

/** A model whose doStream never resolves; records the signal it got. */
function hanging(id) {
  const m = {
    signal: /** @type {AbortSignal | undefined} */ (undefined),
    model: new MockLanguageModelV4({
      modelId: id,
      doStream: async (opts) => {
        m.signal = opts.abortSignal;
        return new Promise(() => {});
      }
    })
  };
  return m;
}

/** Runs streamText over the model and collects text and errors from result.stream. */
async function run(model, extra = {}) {
  const result = streamText({ model, prompt: 'hi', maxRetries: 0, ...extra });
  const parts = [];
  for await (const p of result.stream) parts.push(p);
  return {
    result,
    parts,
    text: parts
      .filter((p) => p.type === 'text-delta')
      .map((p) => p.text)
      .join(''),
    errors: parts.filter((p) => p.type === 'error').map((p) => p.error)
  };
}

describe('withFallback', () => {
  it('falls back from a capacity error to the next candidate', async () => {
    const A = new MockLanguageModelV4({
      modelId: 'A',
      doStream: async () => {
        throw apiError(503, 'Model is at capacity');
      }
    });
    const onTry = vi.fn();
    const model = withFallback({
      candidates: [
        { id: 'A', model: A },
        { id: 'B', model: answering('B', 'from B') }
      ],
      startCutMs: 500,
      cooldown: createCooldown(),
      onTry
    });
    const { text, result } = await run(model);
    expect(text).toBe('from B');
    expect(onTry.mock.calls.map(([e]) => ({ id: e.id, ok: e.ok, reason: e.reason }))).toEqual([
      { id: 'A', ok: false, reason: 'capacity' },
      { id: 'B', ok: true, reason: undefined }
    ]);
    expect((await result.steps)[0].response.modelId).toBe('B');
  });

  it('cuts a model whose call never resolves and aborts its request', async () => {
    const A = hanging('A');
    const onTry = vi.fn();
    const model = withFallback({
      candidates: [
        { id: 'A', model: A.model },
        { id: 'B', model: answering('B', 'from B') }
      ],
      startCutMs: 30,
      cooldown: createCooldown(),
      onTry
    });
    const { text } = await run(model);
    expect(text).toBe('from B');
    expect(onTry.mock.calls[0][0]).toMatchObject({ id: 'A', ok: false, reason: 'no_start' });
    expect(A.signal?.aborted).toBe(true);
  });

  it('cuts a model that sends stream-start and then nothing', async () => {
    let signal;
    let cancelled = false;
    const A = new MockLanguageModelV4({
      modelId: 'A',
      doStream: async (opts) => {
        signal = opts.abortSignal;
        return {
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: 'stream-start', warnings: [] });
            },
            cancel() {
              cancelled = true;
            }
          })
        };
      }
    });
    const onTry = vi.fn();
    const model = withFallback({
      candidates: [
        { id: 'A', model: A },
        { id: 'B', model: answering('B', 'from B') }
      ],
      startCutMs: 30,
      cooldown: createCooldown(),
      onTry
    });
    const { text } = await run(model);
    expect(text).toBe('from B');
    expect(onTry.mock.calls[0][0]).toMatchObject({ id: 'A', ok: false, reason: 'no_start' });
    expect(signal.aborted).toBe(true);
    expect(cancelled).toBe(true);
  });

  it('a user abort neither falls back nor marks a cooldown', async () => {
    const A = hanging('A');
    const B = answering('B', 'from B');
    const cooldown = createCooldown();
    const onTry = vi.fn();
    const model = withFallback({
      candidates: [
        { id: 'A', model: A.model },
        { id: 'B', model: B }
      ],
      startCutMs: 1000,
      cooldown,
      onTry
    });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    const { text } = await run(model, { abortSignal: ac.signal });
    expect(text).toBe('');
    expect(B.doStreamCalls).toHaveLength(0);
    expect(onTry).not.toHaveBeenCalled();
    expect(cooldown.skip('A')).toBe(false);
    expect(A.signal?.aborted).toBe(true);
  });

  it('skips a candidate on cooldown, but tries the first when all are', async () => {
    const A = answering('A', 'from A');
    const B = answering('B', 'from B');
    const candidates = [
      { id: 'A', model: A },
      { id: 'B', model: B }
    ];
    const cooldown = createCooldown();
    cooldown.mark('A');
    expect((await run(withFallback({ candidates, startCutMs: 500, cooldown }))).text).toBe(
      'from B'
    );
    expect(A.doStreamCalls).toHaveLength(0);
    cooldown.mark('B');
    expect((await run(withFallback({ candidates, startCutMs: 500, cooldown }))).text).toBe(
      'from A'
    );
  });

  it('cooldown expires after its time', () => {
    let t = 0;
    const cooldown = createCooldown({ ms: 100, now: () => t });
    cooldown.mark('A');
    expect(cooldown.skip('A')).toBe(true);
    t = 101;
    expect(cooldown.skip('A')).toBe(false);
  });

  it('rethrows a 400 without trying the next model', async () => {
    const A = new MockLanguageModelV4({
      modelId: 'A',
      doStream: async () => {
        throw apiError(400, 'bad request');
      }
    });
    const B = answering('B', 'from B');
    const cooldown = createCooldown();
    const model = withFallback({
      candidates: [
        { id: 'A', model: A },
        { id: 'B', model: B }
      ],
      startCutMs: 500,
      cooldown
    });
    const { errors, text } = await run(model);
    expect(text).toBe('');
    expect(errors[0]).toMatchObject({ statusCode: 400 });
    expect(B.doStreamCalls).toHaveLength(0);
    expect(cooldown.skip('A')).toBe(false);
  });

  it('throws unavailable when every candidate fails', async () => {
    const failing = (id, err) =>
      new MockLanguageModelV4({
        modelId: id,
        doStream: async () => ({
          stream: simulateReadableStream({ chunks: [{ type: 'error', error: err }] })
        })
      });
    const cooldown = createCooldown();
    const onTry = vi.fn();
    const model = withFallback({
      candidates: [
        { id: 'A', model: failing('A', apiError(429)) },
        { id: 'B', model: failing('B', new Error('boom')) }
      ],
      startCutMs: 500,
      cooldown,
      onTry
    });
    const { errors } = await run(model);
    expect(errors[0]).toMatchObject({ code: 'unavailable' });
    expect(onTry.mock.calls.map(([e]) => e.reason)).toEqual(['capacity', 'error']);
    expect(cooldown.skip('A') && cooldown.skip('B')).toBe(true);
  });

  it('onWaiting fires once a model is slow, naming the one that would take over', async () => {
    const slow = new MockLanguageModelV4({
      modelId: 'A',
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: textChunks('A', 'late'), initialDelayInMs: 40 })
      })
    });
    const onWaiting = vi.fn();
    const model = withFallback({
      candidates: [
        { id: 'A', model: slow },
        { id: 'B', model: answering('B', 'from B') }
      ],
      startCutMs: 500,
      cooldown: createCooldown(),
      onWaiting,
      waitNoticeMs: 10
    });
    expect((await run(model)).text).toBe('late');
    expect(onWaiting.mock.calls).toEqual([[{ id: 'A', next: 'B' }]]);

    const fast = vi.fn();
    const quick = withFallback({
      candidates: [{ id: 'A', model: answering('A', 'quick') }],
      startCutMs: 500,
      cooldown: createCooldown(),
      onWaiting: fast,
      waitNoticeMs: 10
    });
    expect((await run(quick)).text).toBe('quick');
    await new Promise((r) => setTimeout(r, 30));
    expect(fast).not.toHaveBeenCalled();
  });

  it('a tool step on A, then A fails and B writes the text step', async () => {
    let calls = 0;
    const A = new MockLanguageModelV4({
      modelId: 'A',
      doStream: async () => {
        calls++;
        if (calls > 1) throw apiError(503, 'overloaded');
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'response-metadata', id: 'r1', modelId: 'A', timestamp: new Date(0) },
              { type: 'tool-call', toolCallId: 'c1', toolName: 'look', input: '{"q":"x"}' },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage }
            ]
          })
        };
      }
    });
    const onTry = vi.fn();
    const model = withFallback({
      candidates: [
        { id: 'A', model: A },
        { id: 'B', model: answering('B', 'done') }
      ],
      startCutMs: 500,
      cooldown: createCooldown(),
      onTry
    });
    const { text, result } = await run(model, {
      tools: {
        look: tool({
          inputSchema: jsonSchema({ type: 'object', properties: { q: { type: 'string' } } }),
          execute: async () => 'ok'
        })
      },
      stopWhen: isStepCount(3)
    });
    expect(text).toBe('done');
    const steps = await result.steps;
    expect(steps.map((s) => s.response.modelId)).toEqual(['A', 'B']);
    expect(onTry.mock.calls.map(([e]) => [e.id, e.ok])).toEqual([
      ['A', true],
      ['A', false],
      ['B', true]
    ]);
  });
});
