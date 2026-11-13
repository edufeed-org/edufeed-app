/**
 * Dev-only transcript sink for the Termi chat route.
 *
 * With `TERMI_TRANSCRIPT_DIR` set, every streamed `/api/termi/chat` request is
 * appended as ONE JSON line to `<dir>/termi-<YYYY-MM-DD>.jsonl`: what the
 * client sent (task, messages, lesson state, material names), what the stream
 * carried (text per part, tool calls with inputs and outputs, errors, timings)
 * and how long it took. It exists so a developer can chat on localhost and
 * read the exact exchange afterwards (`scripts/termi-transcript.js`).
 *
 * This is the one place the server writes user text to disk, and only when the
 * operator opts in per deployment; it is unset in production (the privacy
 * policy describes no such recording). A write failure is logged once and never
 * reaches the response.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_OUTPUT_CHARS = 4000;

/** @param {unknown} v */
const clip = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > MAX_OUTPUT_CHARS ? s.slice(0, MAX_OUTPUT_CHARS) + '…' : (v ?? null);
};

/**
 * @param {string | undefined} dir
 * @returns {{ record: (entry: object, prefix?: string) => Promise<void> } | null}
 */
export function createTranscriptSink(dir) {
  if (!dir || dir === 'none') return null;
  /** @type {Promise<unknown> | undefined} */
  let ready;
  let warned = false;
  return {
    async record(entry, prefix = 'termi') {
      try {
        ready ??= mkdir(dir, { recursive: true });
        await ready;
        const day = new Date().toISOString().slice(0, 10);
        await appendFile(path.join(dir, `${prefix}-${day}.jsonl`), JSON.stringify(entry) + '\n');
      } catch (err) {
        if (!warned) {
          warned = true;
          console.warn(
            '[termi transcript] write failed:',
            /** @type {any} */ (err)?.code ?? 'unknown'
          );
        }
      }
    }
  };
}

/**
 * Folds the UI-message-stream chunks of one response into a compact record:
 * text per part (in order), tool calls with their inputs and outputs, errors.
 * @param {{ t: number, c: any }[]} chunks  chunk objects with their offset in ms
 */
export function summarizeChunks(chunks) {
  /** @type {Map<string, string>} */
  const text = new Map();
  /** @type {Map<string, { name: string, input?: unknown, output?: unknown, error?: string, at: number }>} */
  const tools = new Map();
  /** @type {string[]} */
  const errors = [];
  /** @type {Record<string, number>} */
  const counts = {};
  let finishReason;
  let firstChunkMs;
  for (const { t, c } of chunks) {
    counts[c.type] = (counts[c.type] ?? 0) + 1;
    if (firstChunkMs === undefined && c.type !== 'start') firstChunkMs = t;
    switch (c.type) {
      case 'text-delta':
        text.set(c.id, (text.get(c.id) ?? '') + c.delta);
        break;
      case 'tool-input-available':
        tools.set(c.toolCallId, { name: c.toolName, input: c.input, at: t });
        break;
      case 'tool-output-available': {
        const e = tools.get(c.toolCallId);
        if (e) e.output = clip(c.output);
        break;
      }
      case 'tool-output-error': {
        const e = tools.get(c.toolCallId);
        if (e) e.error = String(c.errorText ?? '');
        break;
      }
      case 'error':
        errors.push(String(c.errorText ?? ''));
        break;
      case 'abort':
        errors.push('abort: ' + String(c.reason ?? ''));
        break;
      case 'finish':
        finishReason = c.finishReason;
        break;
      default:
        break;
    }
  }
  return {
    text: [...text.values()]
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n\n'),
    tools: [...tools.values()],
    errors,
    counts,
    finishReason,
    firstChunkMs
  };
}

/**
 * Returns a Response whose body is the given one, unchanged, and records a
 * transcript entry once the stream has ended (also when the client aborted).
 * @param {Response} response  the SSE response from `createUIMessageStreamResponse`
 * @param {object} meta  request-side fields (task, pubkey, messages, lesson, materials …)
 * @param {{ record: (entry: object) => Promise<void> }} sink
 */
export function teeTranscript(response, meta, sink) {
  if (!response.body) return response;
  const [client, copy] = response.body.tee();
  const t0 = Date.now();
  void readSse(copy)
    .then((chunks) =>
      sink.record({
        ts: new Date(t0).toISOString(),
        ...meta,
        durationMs: Date.now() - t0,
        status: response.status,
        ...summarizeChunks(chunks)
      })
    )
    .catch(() => {});
  return new Response(client, { status: response.status, headers: response.headers });
}

/** Parses `data: {…}` frames off an SSE body. @param {ReadableStream<Uint8Array>} body */
async function readSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const t0 = Date.now();
  /** @type {{ t: number, c: any }[]} */
  const chunks = [];
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i).trim();
        buf = buf.slice(i + 2);
        if (!frame.startsWith('data:')) continue;
        const data = frame.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          chunks.push({ t: Date.now() - t0, c: JSON.parse(data) });
        } catch {
          /* not a JSON frame */
        }
      }
    }
  } catch {
    /* the client went away: record what arrived */
  }
  return chunks;
}
