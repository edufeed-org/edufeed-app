/**
 * One language model to the AI SDK that tries several candidates in order: a
 * candidate that fails or does not start streaming within `startCutMs` is
 * replaced by the next one before any of its output reaches the user.
 */

/** How long a model that failed is skipped by every request. */
export const COOLDOWN_MS = 90_000;
/** After this long without a start the caller is told who would take over. */
export const WAIT_NOTICE_MS = 8_000;

/** Chunk types that mean the model has really begun answering. */
const STARTED = new Set([
  'text-start',
  'text-delta',
  'reasoning-start',
  'reasoning-delta',
  'tool-input-start',
  'tool-call',
  'finish'
]);

/**
 * @param {{ ms?: number, now?: () => number }} [opts]
 * @returns {{ skip(id: string): boolean, mark(id: string): void }}
 */
export function createCooldown({ ms = COOLDOWN_MS, now = Date.now } = {}) {
  /** @type {Map<string, number>} */
  const until = new Map();
  return {
    skip: (id) => (until.get(id) ?? 0) > now(),
    mark: (id) => void until.set(id, now() + ms)
  };
}

/** Shared by all requests of this server process. */
export const modelCooldown = createCooldown();

/**
 * @param {any} err
 * @returns {'capacity' | 'error' | null} null = a client error (4xx but 429) another model would repeat
 */
function reasonOf(err) {
  const status = err?.statusCode;
  if (status === 429 || status >= 500) return 'capacity';
  if (status >= 400) return null;
  return /capacity|overloaded/i.test(String(err?.message ?? '')) ? 'capacity' : 'error';
}

const NO_START = Symbol('no_start');

/**
 * Runs a caller's callback; its failure must never change a try's outcome or escape a timer.
 * @template T @param {((e: T) => void) | undefined} fn @param {T} e
 */
function notify(fn, e) {
  try {
    fn?.(e);
  } catch {
    // ignored on purpose: a broken listener is not a broken model
  }
}

/**
 * @typedef {{ id: string, model: any }} Candidate
 * @typedef {{ id: string, ok: boolean, reason?: 'capacity'|'no_start'|'error', ms: number }} TryEvent
 */

/**
 * @param {{
 *   candidates: Candidate[],
 *   startCutMs: number,
 *   cooldown: { skip(id: string): boolean, mark(id: string): void },
 *   onTry?: (e: TryEvent) => void,
 *   onWaiting?: (e: { id: string, next?: string }) => void,
 *   waitNoticeMs?: number
 * }} opts
 * @returns {any} a LanguageModel (same specificationVersion as the first candidate)
 */
export function withFallback({
  candidates,
  startCutMs,
  cooldown,
  onTry,
  onWaiting,
  waitNoticeMs = WAIT_NOTICE_MS
}) {
  const first = candidates[0].model;

  /**
   * One attempt: resolves with the committed stream result, or rejects with
   * NO_START (timer), the outer abort reason, or the model's error.
   * @param {Candidate} c @param {string | undefined} next @param {any} options
   */
  async function attempt(c, next, options) {
    const outer = /** @type {AbortSignal | undefined} */ (options.abortSignal);
    const own = new AbortController();
    const signal = outer ? AbortSignal.any([outer, own.signal]) : own.signal;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let cutTimer;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let waitTimer;
    /** @type {() => void} */
    let onAbort = () => {};
    /** @type {ReadableStreamDefaultReader<any> | undefined} */
    let reader;
    /** @type {Promise<never>} */
    const stop = new Promise((_, reject) => {
      cutTimer = setTimeout(() => reject(NO_START), startCutMs);
      onAbort = () => reject(outer?.reason);
      outer?.addEventListener('abort', onAbort);
    });
    stop.catch(() => {});
    if (onWaiting)
      waitTimer = setTimeout(() => notify(onWaiting, { id: c.id, next }), waitNoticeMs);
    const settle = () => {
      clearTimeout(cutTimer);
      clearTimeout(waitTimer);
      outer?.removeEventListener('abort', onAbort);
    };
    try {
      if (outer?.aborted) throw outer.reason;
      // The race covers a call that never resolves even though it got the signal.
      const res = await Promise.race([c.model.doStream({ ...options, abortSignal: signal }), stop]);
      reader = res.stream.getReader();
      const buffer = [];
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), stop]);
        if (done) break;
        if (value.type === 'error') throw value.error;
        buffer.push(value);
        if (STARTED.has(value.type)) break;
      }
      settle();
      const rest = /** @type {ReadableStreamDefaultReader<any>} */ (reader);
      return {
        ...res,
        stream: new ReadableStream({
          start(ctrl) {
            for (const part of buffer) ctrl.enqueue(part);
          },
          async pull(ctrl) {
            const { done, value } = await rest.read();
            if (done) ctrl.close();
            else ctrl.enqueue(value);
          },
          cancel: (reason) => rest.cancel(reason)
        })
      };
    } catch (err) {
      settle();
      own.abort();
      reader?.cancel().catch(() => {});
      throw err;
    }
  }

  return {
    specificationVersion: first.specificationVersion,
    provider: first.provider,
    modelId: first.modelId,
    get supportedUrls() {
      return first.supportedUrls;
    },
    /** @param {any} options */
    doGenerate: (options) => first.doGenerate(options),
    /** @param {any} options */
    async doStream(options) {
      let list = candidates.filter((c) => !cooldown.skip(c.id));
      if (!list.length) list = [candidates[0]];
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const t0 = Date.now();
        try {
          const res = await attempt(c, list[i + 1]?.id, options);
          notify(onTry, { id: c.id, ok: true, ms: Date.now() - t0 });
          return res;
        } catch (err) {
          if (options.abortSignal?.aborted) throw err;
          const reason = err === NO_START ? 'no_start' : reasonOf(err);
          if (!reason) throw err;
          cooldown.mark(c.id);
          notify(onTry, { id: c.id, ok: false, reason, ms: Date.now() - t0 });
        }
      }
      throw Object.assign(new Error('termi: no model available'), { code: 'unavailable' });
    }
  };
}
