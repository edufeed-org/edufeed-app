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
import { isRateable } from '$lib/termi/feedback.js';
import {
  articleDraft,
  buildSourcesSection,
  citedItems,
  documentFilename,
  documentMarkdown,
  draftSummary,
  fillAuthor,
  isDocumentAnswer,
  liascriptCourseUrl,
  stashArticlePrefill,
  stripLinks
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
 *   openLessonPublish?: () => void,
 *   workbench?: boolean,
 *   feedback?: { send: (turn: Turn, choices: FeedbackChoices) => Promise<void>, open: (turn: Turn) => void },
 *   links?: ReturnType<typeof import('$lib/termi/links.js').linkKit> & { open?: (href: string) => void }
 * }} AnswerActionCtx `author`: the signed-in user's name for a LiaScript header's empty `author:`;
 *   `task` … `replaceTurnText`: the lesson task's drafts (`confirm` = the window's modal);
 *   `lessonState` … `openLessonPublish`: phase 7 (`isLatest`: the latest assistant turn);
 *   `workbench`: the Werkbank saves and loads drafts by itself, so no buttons for it;
 *   `links`: the conversation's link rules (`linkKit`) — text that leaves the app goes through `links.exported`;
 *   `feedback`: set only when the deployment takes answer feedback (`open` = the thumbs-down dialog)
 * @typedef {{ vote: 'up' | 'down', reason?: string | null, comment?: string, attach: boolean, named: boolean }} FeedbackChoices
 * @typedef {{
 *   id: string,
 *   label: (ctx: AnswerActionCtx, state?: ActionState) => string,
 *   when: (turn: Turn, ctx: AnswerActionCtx) => boolean,
 *   run: (turn: Turn, ctx: AnswerActionCtx, prev?: ActionState) => Promise<Partial<Turn> | void>,
 *   ghost?: boolean
 * }} AnswerAction `prev`: the action's state before this click
 */

// Sources: what the cards show, minus people/communities (not sources of a text).
/** A rendered turn holds Items: toTier1Message turns stored SlimItems back into Items. @param {Turn} turn */
const sourceItems = (turn) =>
  /** @type {Item[]} */ (turn.items ?? []).filter(
    (i) => keepItem(i) && ['resource', 'passage', 'event'].includes(i.type)
  );
/** @param {Turn} turn @param {AnswerActionCtx} ctx */
const exportText = (turn, ctx) =>
  documentMarkdown(turn.text, sourceItems(turn), ctx.locale, ctx.author, ctx.links?.exported);
/** @param {Turn} turn @param {AnswerActionCtx} ctx */
const draftOf = (turn, ctx) =>
  articleDraft(turn.text, sourceItems(turn), ctx.locale, ctx.author, ctx.links?.exported);

/**
 * The generated "Quellen und Lizenzen" section of a document, as the export ends with it
 * (the view shows it; never part of the stored text). Empty without sources.
 * @param {Turn} turn @param {string} text the document's text @param {string} locale
 */
export const sourcesSectionOf = (turn, text, locale) => {
  const items = sourceItems(turn);
  return items.length ? buildSourcesSection(citedItems(text, items), locale) : '';
};

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
    /** Every part of a lesson answer as its own NIP-37 wrap (encrypted); automatic only in the Werkbank. */
    id: 'save_draft',
    label: (_ctx, state) => (state?.ok ? m.termi_lesson_saved() : m.termi_lesson_save_draft()),
    when: (turn, ctx) =>
      ctx.task === 'lesson' &&
      !ctx.workbench &&
      turn.role === 'assistant' &&
      !!turn.lessonParts?.length &&
      !turn.pending &&
      !turn.textStub &&
      !!ctx.user,
    async run(turn, ctx) {
      const id = /** @type {string} */ (turn.id);
      await saveLessonParts(turn, turn.lessonParts ?? [], ctx);
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
          { ...part, text: fillAuthor(exportedPartText(part.text, ctx), ctx.author) },
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
    when: (turn, ctx) =>
      !ctx.workbench && !!turn.textStub && !!turn.artifacts?.draftWraps && !!ctx.user,
    run: (turn, ctx) => loadTurnDrafts(turn, ctx)
  },
  {
    /** Thumbs up: sent at once, metadata only, never by name. `ok` = sent; the later vote is the lit one. */
    id: 'feedback_up',
    ghost: true,
    label: (_ctx, state) => feedbackLabel(state, m.termi_feedback_up(), m.termi_feedback_up_done()),
    when: canRate,
    async run(turn, ctx, prev) {
      const id = /** @type {string} */ (turn.id);
      // a sent rating cannot be taken back, and a second one says nothing new
      if (!ctx.feedback) throw new Error('Feedback is off');
      if (!prev?.ok) await ctx.feedback.send(turn, { vote: 'up', attach: false, named: false });
      markFeedbackSent(id, 'up', ctx);
    }
  },
  {
    /** Thumbs down: the window's dialog asks why and sends; it marks the thumb once that worked. */
    id: 'feedback_down',
    ghost: true,
    label: (_ctx, state) =>
      feedbackLabel(state, m.termi_feedback_down(), m.termi_feedback_down_done()),
    when: canRate,
    async run(turn, ctx, prev) {
      ctx.feedback?.open(turn);
      // still lit after an earlier dialog was sent
      if (prev?.ok) ctx.setState(/** @type {string} */ (turn.id), 'feedback_down', prev);
    }
  }
];

/** @param {Turn} turn @param {AnswerActionCtx} ctx */
function canRate(turn, ctx) {
  return !!ctx.feedback && isRateable(turn);
}
/** @param {ActionState | undefined} state @param {string} idle @param {string} done */
const feedbackLabel = (state, idle, done) =>
  state?.failed ? m.termi_feedback_failed() : state?.ok ? done : idle;

/** Lights the thumb whose rating went out and puts out the other one. @param {string} turnId @param {'up'|'down'} vote @param {AnswerActionCtx} ctx */
export function markFeedbackSent(turnId, vote, ctx) {
  ctx.setState(turnId, 'feedback_up', vote === 'up' ? { ok: true } : undefined);
  ctx.setState(turnId, 'feedback_down', vote === 'down' ? { ok: true } : undefined);
}

/** A part's text for a wrap or a published draft: validated links, absolute. Without link rules: links reduced to their text, as in `documentMarkdown`. @param {string} text @param {AnswerActionCtx} ctx */
const exportedPartText = (text, ctx) => (ctx.links?.exported ?? stripLinks)(text);

/** @type {Promise<typeof import('$lib/stores/lesson-drafts.svelte.js')> | undefined} */
let draftStore;

/**
 * A stub answer's parts, decrypted from their wraps in parallel: the turn text is whole
 * again. Nothing is replaced unless every part decrypts (the bubble says "nicht entschlüsselbar").
 * @param {Turn} turn @param {AnswerActionCtx} ctx
 */
export async function loadTurnDrafts(turn, ctx) {
  // memoised for turns loading at once; a failed import is forgotten so a retry can succeed
  const store = await (draftStore ??= import('$lib/stores/lesson-drafts.svelte.js')).catch(
    (err) => {
      draftStore = undefined;
      throw err;
    }
  );
  // one at a time inside a turn: a NIP-46 bunker decrypts sequentially anyway
  const texts = [];
  for (const [key, naddr] of Object.entries(turn.artifacts?.draftWraps ?? {})) {
    const draft = await store.loadLessonDraft(naddr);
    if (!draft) throw new Error('draft unreadable');
    // an ask document has no marker: its text is the whole turn
    texts.push(
      key === 'document'
        ? draft.content
        : `<!-- termi:part ${key.replace('-', ' ')} -->\n${draft.content}`
    );
  }
  ctx.replaceTurnText?.(/** @type {string} */ (turn.id), texts.join('\n\n'));
}

/**
 * Saves the given parts of one turn as NIP-37 wraps, one at a time (a bunker signs
 * sequentially anyway): each lands in the lesson state (`recordPartWrap`) and, once
 * the loop ends — also on a failure — in the turn's `draftWraps`. Used by
 * "Als Entwurf speichern" and by phase 7's "Fehlende Teile speichern".
 * @param {Turn} turn @param {import('$lib/termi/lesson-state.js').LessonPartText[]} parts
 * @param {AnswerActionCtx} ctx @param {(key: string) => void} [onStart] before each part
 */
export async function saveLessonParts(turn, parts, ctx, onStart) {
  const { saveLessonDraft } = await import('$lib/stores/lesson-drafts.svelte.js');
  const conversationId = /** @type {() => string} */ (ctx.conversationId)();
  // the account and conversation the save started in: a switch mid-save signs and records nothing more
  const pubkey = ctx.user?.pubkey;
  /** @type {Record<string, string>} */
  const wraps = {};
  try {
    for (const part of parts) {
      onStart?.(partKey(part));
      const { naddr } = await saveLessonDraft({
        conversationId,
        part: { ...part, text: exportedPartText(part.text, ctx) },
        pubkey
      });
      wraps[partKey(part)] = naddr;
      ctx.recordPartWrap?.(partKey(part), naddr, part.title, conversationId);
    }
  } finally {
    // the parts saved before a failure keep their wraps
    if (Object.keys(wraps).length)
      ctx.setArtifacts(/** @type {string} */ (turn.id), {
        draftWraps: { ...turn.artifacts?.draftWraps, ...wraps }
      });
  }
}

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
  const prev = ctx.getState(id, action.id);
  if (prev?.busy) return;
  const busy = { busy: true };
  ctx.setState(id, action.id, busy);
  const stillBusy = () => ctx.getState(id, action.id) === busy;
  try {
    const patch = await action.run(turn, ctx, prev);
    if (stillBusy()) ctx.setState(id, action.id, undefined);
    if (patch?.artifacts) ctx.setArtifacts(id, patch.artifacts);
  } catch {
    if (stillBusy()) ctx.setState(id, action.id, { failed: true });
  }
}
