/**
 * Actions under an answer: one contract for every button that acts on a whole
 * answer (copy, download, article draft, LiaScript course; later SCORM and
 * the AMB-form prefill). Tool outputs contribute their own buttons through the
 * registry's `toActions` (show_pages), which land in `turn.actions`.
 *
 * An entry is `{ id, label(ctx, state), when(turn, ctx), run(turn, ctx), ghost? }`.
 * Per-action UI state (copied, busy, failed) lives in the conversation
 * controller keyed by turn id — never by answer text — and reaches an entry
 * through `ctx.getState`/`ctx.setState`. `run` may return a patch; only its
 * `artifacts` are kept (on the turn and in the history).
 */
import * as m from '$lib/paraglide/messages';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { keepItem } from './cards/filter.js';
import { partKey } from '$lib/termi/lesson-state.js';
import {
  articleDraft,
  documentFilename,
  documentMarkdown,
  draftSummary,
  fillAuthor,
  isDocumentAnswer,
  liascriptCourseUrl,
  stashArticlePrefill
} from './document-export.js';

/** @typedef {import('./history/conversation-codec.js').Turn} Turn */
/** @typedef {import('$lib/termi/items.d.js').Item} Item */
/** @typedef {{ busy?: boolean, failed?: boolean, ok?: boolean }} ActionState */
/**
 * @typedef {{
 *   user: any,
 *   locale: string,
 *   author?: string,
 *   close: () => void,
 *   getState: (turnId: string, actionId: string) => ActionState | undefined,
 *   setState: (turnId: string, actionId: string, state: ActionState | undefined) => void,
 *   setArtifacts: (turnId: string, patch: import('./history/conversation-codec.js').Artifacts) => void,
 *   task?: import('./history/conversation-codec.js').TermiTask,
 *   confirm?: (text: string) => Promise<boolean>,
 *   conversationId?: () => string,
 *   recordPartWrap?: (key: string, naddr: string, title?: string, convId?: string) => void,
 *   replaceTurnText?: (turnId: string, text: string) => void,
 *   lessonState?: import('$lib/termi/lesson-state.js').LessonState | null,
 *   isLatest?: (turnId: string) => boolean,
 *   openLessonPublish?: () => void
 * }} AnswerActionCtx `author`: the signed-in user's name for a LiaScript header's empty `author:`;
 *   `task` … `replaceTurnText`: the lesson task's drafts (`confirm` = the window's modal);
 *   `lessonState` … `openLessonPublish`: phase 7 (`isLatest`: the latest assistant turn)
 * @typedef {{
 *   id: string,
 *   label: (ctx: AnswerActionCtx, state?: ActionState) => string,
 *   when: (turn: Turn, ctx: AnswerActionCtx) => boolean,
 *   run: (turn: Turn, ctx: AnswerActionCtx) => Promise<Partial<Turn> | void>,
 *   ghost?: boolean
 * }} AnswerAction
 */

// Sources: what the cards show, minus people/communities (not sources of a text).
/** A rendered turn holds Items: toTier1Message turns stored SlimItems back into Items. @param {Turn} turn */
const sourceItems = (turn) =>
  /** @type {Item[]} */ (turn.items ?? []).filter(
    (i) => keepItem(i) && ['resource', 'passage', 'event'].includes(i.type)
  );
/** @param {Turn} turn @param {AnswerActionCtx} ctx */
const exportText = (turn, ctx) =>
  documentMarkdown(turn.text, sourceItems(turn), ctx.locale, ctx.author);
/** @param {Turn} turn @param {AnswerActionCtx} ctx */
const draftOf = (turn, ctx) => articleDraft(turn.text, sourceItems(turn), ctx.locale, ctx.author);

// sourcesLost: the history cap dropped the outputs — no export without its sources;
// textStub: a stored lesson answer's cut text — nothing to export until its wraps are loaded
/** @param {Turn} turn */
const isDocument = (turn) =>
  turn.role === 'assistant' &&
  !turn.pending &&
  !turn.sourcesLost &&
  !turn.textStub &&
  isDocumentAnswer(turn.text);

/** @type {AnswerAction[]} */
export const ANSWER_ACTIONS = [
  {
    id: 'copy',
    label: (_ctx, state) =>
      state?.ok === undefined
        ? m.termi_doc_copy()
        : state.ok
          ? m.termi_doc_copied()
          : m.termi_doc_copy_failed(),
    when: isDocument,
    async run(turn, ctx) {
      const id = /** @type {string} */ (turn.id);
      let ok = true;
      try {
        await navigator.clipboard.writeText(exportText(turn, ctx));
      } catch {
        ok = false; // no clipboard permission / insecure context: download still works
      }
      // "Kopiert" (or the failure) for 2 s; a later click owns the label from then on
      const state = { ok };
      ctx.setState(id, 'copy', state);
      setTimeout(
        () => ctx.getState(id, 'copy') === state && ctx.setState(id, 'copy', undefined),
        2000
      );
    }
  },
  {
    id: 'download',
    label: () => m.termi_doc_download(),
    when: isDocument,
    async run(turn, ctx) {
      const url = URL.createObjectURL(
        new Blob([exportText(turn, ctx)], { type: 'text/markdown;charset=utf-8' })
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = documentFilename(turn.text);
      a.click();
      URL.revokeObjectURL(url);
    }
  },
  {
    id: 'article',
    label: () => m.termi_doc_article(),
    // a lesson part becomes an article in phase 7, from its wrap
    when: (turn, ctx) => isDocument(turn) && !!ctx.user && ctx.task !== 'lesson',
    async run(turn, ctx) {
      stashArticlePrefill(draftOf(turn, ctx));
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved path plus a query string
      goto(resolve('/create/article') + '?prefill=termi');
      ctx.close();
    }
  },
  {
    /**
     * "Als LiaScript-Kurs öffnen": LiaScript reads a course only from Nostr, so the
     * document becomes the user's unlisted draft (kind 30024) first. Its naddr
     * lives in the turn's artifacts (and in the history), so a restored chat reuses it.
     */
    id: 'liascript',
    label: () => m.termi_doc_liascript(),
    ghost: true,
    // a lesson part goes through liascript_preview: plaintext only after a warning
    when: (turn, ctx) => isDocument(turn) && !!ctx.user && ctx.task !== 'lesson',
    async run(turn, ctx) {
      const saved = turn.artifacts?.draftNaddr;
      if (saved) {
        window.open(liascriptCourseUrl(saved), '_blank', 'noopener');
        return;
      }
      // Opened before the signer's await: a popup blocker refuses a later open.
      const tab = window.open('about:blank', '_blank');
      if (tab) tab.opener = null;
      try {
        // lazy: the publish stack stays out of the Termi chunk until someone needs it
        const { createArticle } = await import('$lib/stores/article-actions.svelte.js');
        const { title, content } = draftOf(turn, ctx);
        // awaitPublish: LiaScript asks the relays at once — the draft must be on one first
        const { naddr } = await createArticle(
          { title, content, summary: draftSummary(content), image: '' },
          undefined,
          null,
          { draft: true, awaitPublish: true }
        );
        if (tab) tab.location.href = liascriptCourseUrl(naddr);
        else window.open(liascriptCourseUrl(naddr), '_blank', 'noopener');
        return { artifacts: { draftNaddr: naddr } };
      } catch (err) {
        console.error('Termi: saving the LiaScript draft failed', err);
        tab?.close();
        throw err;
      }
    }
  },
  {
    /** Every part of a lesson answer as its own NIP-37 wrap (encrypted); never automatic. */
    id: 'save_draft',
    label: (_ctx, state) => (state?.ok ? m.termi_lesson_saved() : m.termi_lesson_save_draft()),
    when: (turn, ctx) =>
      ctx.task === 'lesson' &&
      turn.role === 'assistant' &&
      !!turn.lessonParts?.length &&
      !turn.pending &&
      !turn.textStub &&
      !!ctx.user,
    async run(turn, ctx) {
      const id = /** @type {string} */ (turn.id);
      const { saveLessonDraft } = await import('$lib/stores/lesson-drafts.svelte.js');
      const conversationId = /** @type {() => string} */ (ctx.conversationId)();
      // the account and conversation the save started in: a switch mid-save signs and records nothing more
      const pubkey = ctx.user?.pubkey;
      /** @type {Record<string, string>} */
      const wraps = {};
      try {
        // one at a time: a bunker signs sequentially anyway
        for (const part of turn.lessonParts ?? []) {
          const { naddr } = await saveLessonDraft({ conversationId, part, pubkey });
          wraps[partKey(part)] = naddr;
          ctx.recordPartWrap?.(partKey(part), naddr, part.title, conversationId);
        }
      } finally {
        // the parts saved before a failure keep their wraps
        if (Object.keys(wraps).length)
          ctx.setArtifacts(id, { draftWraps: { ...turn.artifacts?.draftWraps, ...wraps } });
      }
      ctx.setState(id, 'save_draft', { ok: true });
    }
  },
  {
    /** "In LiaScript ansehen" for a saved module: a plaintext 30024, only after the warning. */
    id: 'liascript_preview',
    label: () => m.termi_lesson_preview_open(),
    ghost: true,
    when: (turn, ctx) =>
      ctx.task === 'lesson' &&
      !!ctx.user &&
      !turn.pending &&
      !turn.textStub &&
      !!turn.artifacts?.draftWraps?.module &&
      !!turn.lessonParts?.some((p) => p.kind === 'module'),
    async run(turn, ctx) {
      const saved = turn.artifacts?.draftNaddr;
      if (saved) {
        window.open(liascriptCourseUrl(saved), '_blank', 'noopener');
        return;
      }
      if (!(await ctx.confirm?.(m.termi_lesson_preview_warning()))) return;
      // opened before the signer's await: a popup blocker refuses a later open
      const tab = window.open('about:blank', '_blank');
      if (tab) tab.opener = null;
      try {
        const { previewAsPlaintext } = await import('$lib/stores/lesson-drafts.svelte.js');
        const part = /** @type {any} */ (turn.lessonParts).find(
          (/** @type {any} */ p) => p.kind === 'module'
        );
        // the prompt leaves the header's `author:` empty: her name, as the document export does
        // one preview per conversation: a second one replaces it
        const dTag = ctx.conversationId
          ? `lesson-${ctx.conversationId()}-module-preview`
          : undefined;
        const naddr = await previewAsPlaintext(
          { ...part, text: fillAuthor(part.text, ctx.author) },
          dTag
        );
        if (tab) tab.location.href = liascriptCourseUrl(naddr);
        else window.open(liascriptCourseUrl(naddr), '_blank', 'noopener');
        return { artifacts: { draftNaddr: naddr } };
      } catch (err) {
        console.error('Termi: saving the LiaScript preview failed', err);
        tab?.close();
        throw err;
      }
    }
  },
  {
    /** Phase 7: publish the series — the window's LessonPublishModal does the work. */
    id: 'publish_series',
    label: () => m.termi_lesson_publish(),
    // phase 7, or a sources part (the last one): a model that skips the phase-7 patch still offers it
    when: (turn, ctx) =>
      ctx.task === 'lesson' &&
      (ctx.lessonState?.phase === 7 || !!turn.lessonParts?.some((p) => p.kind === 'sources')) &&
      turn.role === 'assistant' &&
      !turn.pending &&
      !!ctx.user &&
      !!ctx.isLatest?.(/** @type {string} */ (turn.id)),
    async run(_turn, ctx) {
      ctx.openLessonPublish?.();
    }
  },
  {
    /** A stored lesson answer is a stub: its parts come back from their wraps. */
    id: 'load_draft',
    label: () => m.termi_lesson_load_draft(),
    when: (turn, ctx) => !!turn.textStub && !!turn.artifacts?.draftWraps && !!ctx.user,
    async run(turn, ctx) {
      const { loadLessonDraft } = await import('$lib/stores/lesson-drafts.svelte.js');
      const texts = [];
      for (const [key, naddr] of Object.entries(turn.artifacts?.draftWraps ?? {})) {
        const draft = await loadLessonDraft(naddr);
        // nothing is replaced unless every part decrypts (the bubble says "nicht entschlüsselbar")
        if (!draft) throw new Error('draft unreadable');
        texts.push(`<!-- termi:part ${key.replace('-', ' ')} -->\n${draft.content}`);
      }
      ctx.replaceTurnText?.(/** @type {string} */ (turn.id), texts.join('\n\n'));
    }
  }
];

/** The answer actions this turn offers, in button order. @param {Turn} turn @param {AnswerActionCtx} ctx */
export const actionsFor = (turn, ctx) => ANSWER_ACTIONS.filter((a) => a.when(turn, ctx));

/**
 * Runs one action: busy (and refusing a second click) until it settles, a
 * throw leaves it `failed`, a returned `artifacts` patch is kept on the turn.
 * A state the action set itself while running (copy's "Kopiert") stays.
 * @param {Turn} turn @param {AnswerAction} action @param {AnswerActionCtx} ctx
 */
export async function runAnswerAction(turn, action, ctx) {
  const id = /** @type {string} */ (turn.id);
  if (ctx.getState(id, action.id)?.busy) return;
  const busy = { busy: true };
  ctx.setState(id, action.id, busy);
  const stillBusy = () => ctx.getState(id, action.id) === busy;
  try {
    const patch = await action.run(turn, ctx);
    if (stillBusy()) ctx.setState(id, action.id, undefined);
    if (patch?.artifacts) ctx.setArtifacts(id, patch.artifacts);
  } catch {
    if (stillBusy()) ctx.setState(id, action.id, { failed: true });
  }
}
