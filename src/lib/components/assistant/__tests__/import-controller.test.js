/** @vitest-environment node */
// The import pipeline without the window: receive (attach only) → Send (the
// consent) → extract → preview turn → publish → done; the account-switch
// guard, stop and retry. The window test keeps the chip and drop wiring.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const env = vi.hoisted(() => ({ config: /** @type {Record<string, any>} */ ({}) }));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: env.config }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/helpers/run-create-action.js', () => ({ runCreateAction: vi.fn() }));

const extractText = vi.hoisted(() => vi.fn());
const requestExtraction = vi.hoisted(() => vi.fn());
const createEvent = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/calendar-import/index.js', async () => ({
  extractText: (/** @type {any[]} */ ...a) => extractText(...a),
  toImportEvents: (await import('$lib/helpers/calendar-import/events.js')).toImportEvents
}));
vi.mock('../import/extract-request.js', () => ({ requestExtraction }));
vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  eventStore: { getReplaceable: () => undefined }
}));
vi.mock('$lib/stores/calendar-actions.svelte.js', () => ({
  createCalendarActions: () => ({ createEvent })
}));

const { createConversation } = await import('../termi-conversation.svelte.js');
const { createImportController } = await import('../import/import-controller.svelte.js');
const { _resetTermiEligibilityForTests } = await import('../termi-router.js');

const ALICE = { pubkey: 'a'.repeat(64), type: 'nsec', signer: { signEvent: vi.fn() } };
const BOB = { pubkey: 'd'.repeat(64), type: 'nsec', signer: { signEvent: vi.fn() } };
const ROWS = [
  { title: 'Elternabend', startDate: '2026-12-01', startTime: '19:00' },
  { title: 'Sportfest', startDate: '2026-12-02' },
  { title: 'Konzert', startDate: '2026-12-03' }
];

/** @type {any} */
let user;
let eligible = true;
const flush = () => new Promise((r) => setTimeout(r, 0));
/** @param {() => boolean} cond */
async function until(cond) {
  for (let i = 0; i < 200 && !cond(); i++) await flush();
  expect(cond()).toBe(true);
}

function setup() {
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ eligible, gated: true }), { status: 200 })
  );
  const conv = createConversation({ getUser: () => user, fetch: /** @type {any} */ (fetch) });
  const onNeedsLogin = vi.fn();
  const imports = createImportController({
    conversation: conv,
    getUser: () => user,
    locale: () => 'de',
    tz: () => 'Europe/Berlin',
    onNeedsLogin
  });
  return { conv, imports, onNeedsLogin };
}
const file = (name = 'x.xlsx', size = 2) => new File([new Uint8Array(size)], name);
/** @param {ReturnType<typeof setup>['conv']} conv */
const lines = (conv) => conv.turns.map((t) => ({ role: t.role, text: t.text }));
/** @param {ReturnType<typeof setup>['conv']} conv */
const importOf = (conv) => /** @type {any} */ (conv.turns.find((t) => t.import));

/** Attach and send: resolves once the import turn left `extracting`. @param {ReturnType<typeof setup>} s */
async function sent(s, q = '') {
  await s.imports.receiveFile(file());
  expect(s.imports.sendAttachment(q)).toBe(true);
  await until(() => importOf(s.conv)?.import.status !== 'extracting');
  return /** @type {string} */ (importOf(s.conv).id);
}

beforeEach(() => {
  _resetTermiEligibilityForTests();
  env.config.termi = { enabled: true, embed: true, llm: true };
  user = ALICE;
  eligible = true;
  extractText.mockReset();
  extractText.mockResolvedValue({ text: 'Termine im Dezember', kind: 'zip', truncated: false });
  requestExtraction.mockReset();
  requestExtraction.mockResolvedValue({ events: ROWS });
  createEvent.mockReset();
  createEvent.mockResolvedValue({});
});

describe('receive', () => {
  it('only attaches: nothing is read or sent before Send', async () => {
    const { conv, imports } = setup();
    await imports.receiveFile(file('plan.pdf', 2048));
    expect(imports.attachment).toEqual({
      file: expect.any(File),
      size: expect.stringMatching(/KB/)
    });
    expect(extractText).not.toHaveBeenCalled();
    expect(conv.turns).toEqual([]);
    imports.clearAttachment();
    expect(imports.attachment).toBeNull();
    expect(imports.sendAttachment('x')).toBe(false);
  });

  it('a file over 2 MB is refused with a line', async () => {
    const { conv, imports } = setup();
    await imports.receiveFile(file('big.pdf', 3 * 1024 * 1024));
    expect(imports.attachment).toBeNull();
    expect(lines(conv)).toEqual([{ role: 'assistant', text: m.termi_import_too_large() }]);
  });

  it('logged out: needs the assistant, with a login button', async () => {
    user = null;
    const { conv, imports, onNeedsLogin } = setup();
    await imports.receiveFile(file());
    expect(imports.attachment).toBeNull();
    const turn = /** @type {any} */ (conv.turns[0]);
    expect(turn.text).toBe(m.termi_import_needs_assistant());
    turn.actions[0].run();
    expect(onNeedsLogin).toHaveBeenCalled();
  });

  it('not eligible: needs the assistant, no login button', async () => {
    eligible = false;
    const { conv, imports } = setup();
    await imports.receiveFile(file());
    expect(imports.attachment).toBeNull();
    expect(conv.turns[0].actions).toBeUndefined();
  });
});

describe('send → extract → preview', () => {
  it('the instruction is the user bubble and goes along; the preview ticks every row', async () => {
    const s = setup();
    await s.imports.receiveFile(file());
    expect(s.imports.sendAttachment('  nur Dezember  ')).toBe(true);
    expect(s.imports.attachment).toBeNull();
    expect(lines(s.conv)[0]).toEqual({ role: 'user', text: 'nur Dezember' });
    await until(() => importOf(s.conv)?.import.status === 'preview');
    expect(requestExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Termine im Dezember',
        filename: 'x.xlsx',
        locale: 'de',
        tz: 'Europe/Berlin',
        instruction: 'nur Dezember',
        user: ALICE
      })
    );
    const state = importOf(s.conv).import;
    expect(state.events).toHaveLength(3);
    expect(state.selected.size).toBe(3);
    expect(state.tz).toBe('Europe/Berlin');
  });

  it('no instruction: the default prompt bubble', async () => {
    const s = setup();
    await sent(s);
    expect(lines(s.conv)[0].text).toBe(m.termi_import_default_prompt({ file: 'x.xlsx' }));
    expect(requestExtraction.mock.calls[0][0].instruction).toBeUndefined();
  });

  it('a 429 marks the quota (no retry); a 502 fails and re-extracts with the instruction', async () => {
    requestExtraction.mockRejectedValueOnce(
      Object.assign(new Error('q'), { status: 429, scope: 'user' })
    );
    const s = setup();
    const id = await sent(s);
    expect(importOf(s.conv).import).toMatchObject({ status: 'failed', quota: 'user' });

    requestExtraction.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 502 }));
    const t = setup();
    const id2 = await sent(t, 'nur Dezember');
    expect(importOf(t.conv).import).toMatchObject({ status: 'failed', quota: undefined });
    await t.imports.reextract(id2);
    expect(importOf(t.conv).import.status).toBe('preview');
    expect(requestExtraction.mock.calls.map((c) => c[0].instruction).slice(-2)).toEqual([
      'nur Dezember',
      'nur Dezember'
    ]);
    expect(id).toBeTruthy();
  });

  it('no text in the file: a plain line, no request', async () => {
    extractText.mockResolvedValue({ text: '  ', kind: 'pdf', truncated: false });
    const s = setup();
    await s.imports.receiveFile(file('scan.pdf'));
    s.imports.sendAttachment('');
    await until(() => s.conv.turns.at(-1)?.text === m.termi_import_no_text());
    expect(requestExtraction).not.toHaveBeenCalled();
    expect(importOf(s.conv)).toBeUndefined();
  });
});

describe('publish', () => {
  it('publishes the ticked rows → done, recorded', async () => {
    const s = setup();
    const id = await sent(s);
    await s.imports.publish(id);
    expect(createEvent).toHaveBeenCalledTimes(3);
    const state = importOf(s.conv).import;
    expect(state.status).toBe('done');
    expect(state.result.ok).toHaveLength(3);
    expect(state.result.failed).toEqual([]);
  });

  it('an account switch mid-publish stops signing and leaves the old result unwritten', async () => {
    createEvent.mockImplementation(async () => {
      user = BOB;
    });
    const s = setup();
    const id = await sent(s);
    await s.imports.publish(id);
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(importOf(s.conv).import.status).toBe('publishing');
  });

  it('stop: the remaining rows are skipped; retry publishes only failed and skipped rows', async () => {
    const s = setup();
    const id = await sent(s);
    createEvent.mockImplementationOnce(async () => {
      s.imports.stop(id);
    });
    await s.imports.publish(id);
    let state = importOf(s.conv).import;
    expect(state.status).toBe('done');
    expect(state.result.ok).toHaveLength(1);
    expect(state.result.skipped).toHaveLength(2);

    createEvent.mockReset();
    createEvent.mockRejectedValueOnce(new Error('relay_refused')).mockResolvedValue({});
    await s.imports.retry(id);
    expect(createEvent).toHaveBeenCalledTimes(2);
    state = importOf(s.conv).import;
    expect(state.result.ok).toHaveLength(2);
    expect(state.result.failed.map((/** @type {any} */ f) => f.error)).toEqual(['relay_refused']);

    createEvent.mockReset();
    createEvent.mockResolvedValue({});
    await s.imports.retry(id);
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(importOf(s.conv).import.result.ok).toHaveLength(3);
  });

  it('after dispose nothing more is written', async () => {
    const s = setup();
    await s.imports.receiveFile(file());
    s.imports.sendAttachment('');
    s.imports.dispose();
    await flush();
    await flush();
    expect(importOf(s.conv).import.status).toBe('extracting');
  });
});
