/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTranscriptSink, summarizeChunks, teeTranscript } from '../termi/transcript.js';

const sse = (/** @type {object[]} */ objs) =>
  new Response(
    new ReadableStream({
      start(ctrl) {
        const enc = new TextEncoder();
        for (const o of objs) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
        ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
        ctrl.close();
      }
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );

const STREAM = [
  { type: 'start' },
  { type: 'start-step' },
  { type: 'text-start', id: 'a' },
  { type: 'text-delta', id: 'a', delta: 'Ich suche ' },
  { type: 'text-delta', id: 'a', delta: 'kurz.' },
  {
    type: 'tool-input-available',
    toolCallId: 'c1',
    toolName: 'search_content',
    input: { query: 'Brüche' }
  },
  {
    type: 'tool-output-available',
    toolCallId: 'c1',
    output: { items: [{ title: 'Brüche kürzen' }] }
  },
  { type: 'finish-step' },
  { type: 'start-step' },
  { type: 'text-start', id: 'b' },
  { type: 'text-delta', id: 'b', delta: 'Hier ist Material.' },
  { type: 'finish-step' },
  { type: 'finish', finishReason: 'stop' }
];

describe('createTranscriptSink', () => {
  it('is off without a directory', () => {
    expect(createTranscriptSink(undefined)).toBeNull();
    expect(createTranscriptSink('')).toBeNull();
    expect(createTranscriptSink('none')).toBeNull();
  });

  it('appends one JSON line per entry into a dated file', async () => {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), 'termi-tr-')), 'sub');
    const sink = /** @type {NonNullable<ReturnType<typeof createTranscriptSink>>} */ (
      createTranscriptSink(dir)
    );
    await sink.record({ task: 'ask', n: 1 });
    await sink.record({ task: 'lesson', n: 2 });
    const [file] = await readdir(dir);
    expect(file).toMatch(/^termi-\d{4}-\d{2}-\d{2}\.jsonl$/);
    const lines = (await readFile(path.join(dir, file), 'utf8')).trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).n)).toEqual([1, 2]);
  });

  it('swallows a write failure and warns once', async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'termi-tr-')), 'not-a-dir');
    await writeFile(file, 'x');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = /** @type {NonNullable<ReturnType<typeof createTranscriptSink>>} */ (
      createTranscriptSink(file)
    );
    await expect(sink.record({ a: 1 })).resolves.toBeUndefined();
    await expect(sink.record({ a: 2 })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('transcript');
    warn.mockRestore();
  });
});

describe('summarizeChunks', () => {
  it('joins text parts as paragraphs, pairs tool inputs with outputs, keeps errors', () => {
    const s = summarizeChunks([
      ...STREAM.map((c, i) => ({ t: i * 10, c })),
      { t: 200, c: { type: 'error', errorText: 'termi:upstream' } }
    ]);
    expect(s.text).toBe('Ich suche kurz.\n\nHier ist Material.');
    expect(s.tools).toEqual([
      expect.objectContaining({
        name: 'search_content',
        input: { query: 'Brüche' },
        output: { items: [{ title: 'Brüche kürzen' }] }
      })
    ]);
    expect(s.errors).toEqual(['termi:upstream']);
    expect(s.finishReason).toBe('stop');
    expect(s.firstChunkMs).toBe(10);
    expect(s.counts['text-delta']).toBe(3);
  });

  it('clips a huge tool output', () => {
    const big = { items: Array.from({ length: 500 }, (_, i) => ({ title: 'x'.repeat(50) + i })) };
    const s = summarizeChunks([
      { t: 0, c: { type: 'tool-input-available', toolCallId: 'c', toolName: 't', input: {} } },
      { t: 1, c: { type: 'tool-output-available', toolCallId: 'c', output: big } }
    ]);
    expect(typeof s.tools[0].output).toBe('string');
    expect(/** @type {string} */ (s.tools[0].output).length).toBeLessThanOrEqual(4001);
  });
});

describe('teeTranscript', () => {
  it('passes the body through byte-for-byte and records the entry when the stream ends', async () => {
    const record = vi.fn(async () => {});
    const original = await sse(STREAM).text();
    const res = teeTranscript(
      sse(STREAM),
      {
        task: 'ask',
        pubkey: 'p',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Brüche' }] }]
      },
      { record }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(await res.text()).toBe(original);
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const entry = /** @type {any} */ (/** @type {any[]} */ (record.mock.calls[0])[0]);
    expect(entry).toMatchObject({ task: 'ask', pubkey: 'p', status: 200, finishReason: 'stop' });
    expect(entry.text).toContain('Hier ist Material.');
    expect(entry.tools[0].name).toBe('search_content');
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('still records what arrived when the client cancels the stream', async () => {
    const record = vi.fn(async () => {});
    const res = teeTranscript(sse(STREAM), { task: 'ask' }, { record });
    const reader = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
  });

  /** A stream that sends `first` frames, then hangs like a model still answering. */
  const hanging = (/** @type {object[]} */ first) => {
    const cancel = vi.fn();
    const enc = new TextEncoder();
    let i = 0;
    const body = new ReadableStream({
      pull(ctrl) {
        if (i < first.length) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(first[i++])}\n\n`));
        else return new Promise(() => {});
      },
      cancel
    });
    return { cancel, res: new Response(body, { status: 200 }) };
  };

  it('cancelling the client body cancels the source and records what arrived, once, aborted', async () => {
    const record = vi.fn(async () => {});
    const { cancel, res: src } = hanging(STREAM.slice(0, 4));
    const res = teeTranscript(src, { task: 'ask' }, { record });
    const reader = /** @type {ReadableStream<Uint8Array>} */ (res.body).getReader();
    let got = '';
    const dec = new TextDecoder();
    while (!got.includes('Ich suche ')) got += dec.decode((await reader.read()).value);
    await reader.cancel();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(record).toHaveBeenCalledTimes(1);
    const entry = /** @type {any} */ (/** @type {any[]} */ (record.mock.calls[0])[0]);
    expect(entry).toMatchObject({ task: 'ask', status: 200, aborted: true, text: 'Ich suche' });
    expect(entry.counts['text-delta']).toBe(1);
  });

  it('an uncancelled stream records without `aborted`', async () => {
    const record = vi.fn(async () => {});
    await teeTranscript(sse(STREAM), { task: 'ask' }, { record }).text();
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(/** @type {any} */ (/** @type {any[]} */ (record.mock.calls[0])[0])).not.toHaveProperty(
      'aborted'
    );
  });

  it('a sink that rejects or throws never breaks the client stream', async () => {
    const original = await sse(STREAM).text();
    const rejects = { record: vi.fn(async () => Promise.reject(new Error('disk'))) };
    expect(await teeTranscript(sse(STREAM), {}, rejects).text()).toBe(original);
    const throws = {
      record: vi.fn(() => {
        throw new Error('sync');
      })
    };
    expect(await teeTranscript(sse(STREAM), {}, /** @type {any} */ (throws)).text()).toBe(original);
    await vi.waitFor(() => expect(throws.record).toHaveBeenCalledTimes(1));
  });

  it('only pulls from the source when the client pulls', async () => {
    let pulls = 0;
    const src = new Response(
      new ReadableStream(
        {
          pull(ctrl) {
            pulls++;
            ctrl.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'));
          }
        },
        { highWaterMark: 0 }
      )
    );
    const res = teeTranscript(src, {}, { record: async () => {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(pulls).toBeLessThanOrEqual(2);
    await /** @type {ReadableStream} */ (res.body).cancel();
  });
});
