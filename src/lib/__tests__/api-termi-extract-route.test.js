/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';

const ROUTE_URL = 'http://localhost/api/termi/extract';
const PUBKEY = 'a'.repeat(64);
const ENV = {
  TERMI_AI_ENABLED: 'true',
  TERMI_LLM_BASE_URL: 'https://chat-ai.academiccloud.de/v1',
  TERMI_LLM_API_KEY: 'k',
  TERMI_LLM_MODEL: 'qwen3-30b-a3b-instruct-2507',
  NOPE_MCP_URL: 'https://mcp.example/mcp',
  TERMI_ELIGIBLE_NIP05_DOMAINS: 'edufeed.org'
};
const ROW = { title: 'Elternabend', startDate: '2026-12-01', startTime: '19:00' };
const BODY = {
  text: 'SECRET-FILE-TEXT 01.12. Elternabend 19 Uhr',
  filename: 'plan.xlsx',
  locale: 'de',
  today: '2026-11-09',
  tz: 'Europe/Berlin'
};

/** @param {(args: any) => any} impl */
async function importRoute(impl) {
  vi.resetModules();
  vi.doMock('$env/dynamic/private', () => ({ env: ENV }));
  vi.doMock('$lib/server/nip98-verify.js', () => ({ verifyNip98Header: async () => PUBKEY }));
  vi.doMock('$lib/server/termi/eligibility.js', async (importOriginal) => ({
    .../** @type {object} */ (await importOriginal()),
    getTermiEligibilityChecker: () => ({ isEligible: async () => true })
  }));
  const generateText = vi.fn(impl);
  vi.doMock('ai', async (importOriginal) => {
    const real = /** @type {any} */ (await importOriginal());
    return { ...real, generateText: (/** @type {any} */ a) => generateText(a) };
  });
  const { POST } = await import('../../routes/api/termi/extract/+server.js');
  const { termiQuota } = await import('$lib/server/termi/authorize.js');
  const ai = await import('ai');
  return { POST, generateText, termiQuota, ai };
}

/** @param {unknown} body @returns {any} */
function ev(body) {
  const request = new Request(ROUTE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Nostr x' },
    body: JSON.stringify(body)
  });
  return { request, url: new URL(ROUTE_URL) };
}

afterEach(() => {
  vi.doUnmock('$env/dynamic/private');
  vi.doUnmock('$lib/server/nip98-verify.js');
  vi.doUnmock('$lib/server/termi/eligibility.js');
  vi.doUnmock('ai');
  vi.restoreAllMocks();
});

describe('POST /api/termi/extract', () => {
  it('400 invalid_body on a 65 000-char text or a missing filename', async () => {
    const { POST, generateText } = await importRoute(() => ({}));
    const long = await POST(ev({ ...BODY, text: 'x'.repeat(65_000) }));
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: 'invalid_body' });
    expect((await POST(ev({ ...BODY, filename: undefined }))).status).toBe(400);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('answers { events } from structured output and charges the quota once', async () => {
    const { POST, generateText, termiQuota } = await importRoute(() => ({
      output: { events: [ROW] }
    }));
    const charge = vi.spyOn(termiQuota, 'charge');
    const res = await POST(ev(BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [ROW] });
    expect(charge).toHaveBeenCalledTimes(1);
    const args = generateText.mock.calls[0][0];
    expect(args.maxRetries).toBe(0);
    expect(args.temperature).toBe(0);
    expect(args.output).toBeDefined();
    expect(args.prompt).toContain('2026-11-09');
    expect(args.prompt).toContain(BODY.text);
  });

  it('forwards the trimmed instruction, capped at 500 chars, as a hint', async () => {
    const { POST, generateText } = await importRoute(() => ({ output: { events: [] } }));
    await POST(ev({ ...BODY, instruction: '  nur Elternabende  ' }));
    const prompt = generateText.mock.calls[0][0].prompt;
    expect(prompt).toContain(
      'Hinweis der Nutzerin/des Nutzers: «nur Elternabende» — befolge ihn bei der Auswahl und Deutung der Termine, erfinde aber keine Termine.'
    );
    await POST(ev({ ...BODY, instruction: 'y'.repeat(600) }));
    const capped = generateText.mock.calls[1][0].prompt;
    expect(capped).toContain(`«${'y'.repeat(500)}»`);
    expect(capped).not.toContain('y'.repeat(501));
    await POST(ev(BODY));
    expect(generateText.mock.calls[2][0].prompt).not.toContain('Hinweis der Nutzerin');
  });

  it('both model calls carry a 60 s abort signal', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { POST, generateText } = await importRoute((args) =>
      args.output ? { output: {} } : { text: JSON.stringify({ events: [ROW] }) }
    );
    expect((await POST(ev(BODY))).status).toBe(200);
    expect(generateText).toHaveBeenCalledTimes(2);
    for (const [args] of generateText.mock.calls)
      expect(args.abortSignal).toBeInstanceOf(AbortSignal);
    expect(timeout.mock.calls).toEqual([[60_000], [60_000]]);
  });

  it('retries once without output when structured output is rejected, parsing the text', async () => {
    let calls = 0;
    const { POST, generateText, ai, termiQuota } = await importRoute((args) => {
      calls++;
      if (args.output) {
        throw new ai.APICallError({
          message: 'response_format json_schema is not supported',
          url: 'x',
          requestBodyValues: {},
          statusCode: 400
        });
      }
      return { text: `Hier: {"events":[${JSON.stringify(ROW)}]} fertig` };
    });
    const charge = vi.spyOn(termiQuota, 'charge');
    const res = await POST(ev(BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [ROW] });
    expect(calls).toBe(2);
    // Both SAIA calls are charged: a plain-text retry spends budget too.
    expect(charge).toHaveBeenCalledTimes(2);
    expect(generateText.mock.calls[1][0].output).toBeUndefined();
  });

  it('an object without an events array triggers the plain retry, charged again', async () => {
    const { POST, generateText, termiQuota } = await importRoute((args) =>
      args.output ? { output: { rows: [] } } : { text: JSON.stringify({ events: [ROW] }) }
    );
    const charge = vi.spyOn(termiQuota, 'charge');
    const res = await POST(ev(BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [ROW] });
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(charge).toHaveBeenCalledTimes(2);
  });

  it('502 when both attempts fail, and never logs the file text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST, ai } = await importRoute(() => {
      throw new ai.NoObjectGeneratedError(
        /** @type {any} */ ({ message: `failed on ${BODY.text}` })
      );
    });
    const res = await POST(ev(BODY));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'termi:upstream' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET-FILE-TEXT');
  });

  it('502 on another upstream error without a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST, generateText } = await importRoute(() => {
      throw Object.assign(new Error('boom'), { statusCode: 500 });
    });
    expect((await POST(ev(BODY))).status).toBe(502);
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
