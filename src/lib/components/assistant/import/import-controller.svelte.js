/* eslint-disable svelte/prefer-svelte-reactivity -- the Sets are import-state data, replaced through patchImport, never mutated in place */
// File import, without the window: any dropped or picked file → attachment
// chip → Send (the consent; the typed text goes along as instruction) → text
// in the browser → /api/termi/extract (SAIA) → preview → publish. Needs the
// assistant (its NIP-05 gate and quota); nothing leaves the browser before
// Send. Import turns go through the conversation; the window keeps the chip
// and the drop overlay.
import * as m from '$lib/paraglide/messages';
import { formatFileSize } from '$lib/helpers/media-meta.js';
import { getLocale } from '$lib/paraglide/runtime';
import { localToday } from '../termi-chat-request.js';
import { markTermiIneligible } from '../termi-router.js';

/** @typedef {import('./publish-imported.js').ImportState} ImportState */

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const IMPORT_ACCEPT =
  '.pdf,.docx,.xlsx,.odt,.ods,.csv,.tsv,.txt,.md,.ics,.html,.htm,.json,.xml,text/*';

/**
 * @param {{
 *   conversation: ReturnType<typeof import('../termi-conversation.svelte.js').createConversation>,
 *   getUser: () => any,
 *   locale?: () => string,
 *   tz?: () => string,
 *   onNeedsLogin?: () => void
 * }} deps onNeedsLogin: the "Anmelden" button under "needs the assistant" when logged out
 */
export function createImportController({
  conversation: conv,
  getUser,
  locale = getLocale,
  tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  onNeedsLogin = () => {}
}) {
  /** The one file waiting above the composer. @type {{ file: File, size: string } | null} */
  let attachment = $state.raw(null);
  // Plain let: an import still waiting on a chunk must not sign or send after close.
  let destroyed = false;
  /** Import turn ids whose publishing the user stopped; bookkeeping, never rendered. */
  const stoppedImports = new Set();

  /** Only attaches the file to the composer; nothing is read or sent yet. @param {File} file */
  async function receiveFile(file) {
    if (file.size > MAX_IMPORT_BYTES) {
      conv.append({ role: 'assistant', text: m.termi_import_too_large() });
      return;
    }
    const user = getUser();
    const allowed = await conv.assistantAllowed(user);
    if (destroyed) return;
    if (!allowed) {
      const login = { label: m.common_login(), run: onNeedsLogin };
      conv.append(
        user
          ? { role: 'assistant', text: m.termi_import_needs_assistant() }
          : { role: 'assistant', text: m.termi_import_needs_assistant(), actions: [login] }
      );
      return;
    }
    attachment = { file, size: formatFileSize(file.size) ?? '0 B' };
  }

  /**
   * Send with an attachment: the user bubble, then the extraction.
   * @param {string} q @returns {boolean} false when not taken (no file, the chat is busy)
   */
  function sendAttachment(q) {
    if (!attachment || conv.chatBusy) return false;
    const { file } = attachment;
    attachment = null;
    const instruction = q.trim().slice(0, 500);
    /** @type {ImportState} */
    const state = {
      source: file.name,
      status: 'extracting',
      withDescriptions: false,
      done: 0,
      ...(instruction ? { instruction } : {})
    };
    conv.append({ role: 'user', text: conv.importPrompt(state) }, { importOf: true });
    reextract(conv.append({ role: 'assistant', text: '', import: state }, { file }));
    return true;
  }

  /** Read the file, send its text (and the instruction), show the preview. @param {string} id */
  async function reextract(id) {
    const turn = conv.importTurn(id);
    const file = conv.fileOf(id);
    const user = getUser();
    if (!file) return;
    if (!user) {
      conv.patchImport(id, { status: 'failed', quota: 'ineligible' });
      return;
    }
    conv.patchImport(id, { status: 'extracting', quota: undefined });
    try {
      const [{ extractText, toImportEvents }, { requestExtraction }] = await Promise.all([
        import('$lib/helpers/calendar-import/index.js'),
        import('./extract-request.js')
      ]);
      const { text, truncated } = await extractText(file);
      if (destroyed) return;
      if (!text.trim()) {
        conv.replaceImport(id, m.termi_import_no_text());
        return;
      }
      const zone = tz();
      const raw = await requestExtraction({
        text,
        filename: file.name.slice(0, 200),
        locale: locale() === 'en' ? 'en' : 'de',
        today: localToday(),
        tz: zone,
        instruction: turn?.import?.instruction,
        user: /** @type {any} */ (user)
      });
      const events = toImportEvents(raw, { tz: zone });
      const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte.js');
      if (destroyed) return;
      const already = new Set(
        events
          .filter((e) => e.dTag && eventStore.getReplaceable(e.kind, user.pubkey, e.dTag))
          .map((e) => e.key)
      );
      const selected = new Set(
        events.filter((e) => !e.problem && !already.has(e.key)).map((e) => e.key)
      );
      conv.patchImport(id, { status: 'preview', events, already, selected, truncated, tz: zone });
    } catch (err) {
      if (destroyed) return;
      const e = /** @type {{ status?: number, scope?: string } | null} */ (err);
      if (e?.status === 403) markTermiIneligible(user.pubkey);
      /** @type {ImportState['quota']} */
      let quota;
      if (e?.status === 429) quota = e.scope === 'user' ? 'user' : 'global';
      else if (e?.status === 403) quota = 'ineligible';
      conv.patchImport(id, { status: 'failed', quota });
    }
  }

  /**
   * Publishes the ticked rows, or only `keys` (retry of the failed ones).
   * @param {string} id @param {Set<string>} [keys]
   */
  async function publish(id, keys) {
    const state = conv.importTurn(id)?.import;
    if (!state?.events) return;
    const wanted = keys ?? state.selected ?? new Set();
    const list = state.events.filter((e) => !e.problem && wanted.has(e.key));
    const previousOk = keys ? (state.result?.ok ?? []) : [];
    const startPubkey = getUser()?.pubkey;
    stoppedImports.delete(id);
    conv.patchImport(id, {
      status: 'publishing',
      selected: new Set(list.map((e) => e.key)),
      done: 0
    });
    let modules;
    try {
      modules = await Promise.all([
        import('$lib/stores/calendar-actions.svelte.js'),
        import('./publish-imported.js')
      ]);
    } catch {
      // Chunk load failed (offline, new deploy): every row stays unconfirmed, retry offered.
      if (destroyed) return;
      const failed = list.map((e) => ({ key: e.key, error: 'load_failed' }));
      conv.patchImport(id, { status: 'done', result: { ok: previousOk, failed } });
      return;
    }
    const [{ createCalendarActions }, { publishImportedEvents }] = modules;
    const actions = createCalendarActions('');
    const result = await publishImportedEvents(list, {
      createEvent: (...a) => actions.createEvent(...a),
      withDescriptions: state.withDescriptions,
      tz: state.tz ?? 'UTC',
      onProgress: (done) => conv.patchImport(id, { done }),
      // a switched account must not keep signing the old account's rows
      shouldContinue: () =>
        !destroyed && getUser()?.pubkey === startPubkey && !stoppedImports.has(id)
    });
    if (destroyed || getUser()?.pubkey !== startPubkey) return;
    conv.patchImport(id, {
      status: 'done',
      result: { ok: [...previousOk, ...result.ok], failed: result.failed, skipped: result.skipped }
    });
    conv.saveHistory();
  }

  /** Publishes again only the rows that failed or were skipped. @param {string} id */
  function retry(id) {
    const result = conv.importTurn(id)?.import?.result;
    return publish(
      id,
      new Set([...(result?.failed.map((f) => f.key) ?? []), ...(result?.skipped ?? [])])
    );
  }

  return {
    get attachment() {
      return attachment;
    },
    receiveFile,
    clearAttachment: () => (attachment = null),
    sendAttachment,
    reextract,
    publish,
    retry,
    /** The rows not yet signed stay unsigned. @param {string} id */
    stop: (id) => void stoppedImports.add(id),
    dispose: () => (destroyed = true)
  };
}
