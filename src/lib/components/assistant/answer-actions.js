/**
 * Actions under an answer: one contract for every button that acts on a whole
 * answer (copy, download, article draft, LiaScript course; later SCORM and
 * the AMB-form prefill). Tool outputs contribute their own buttons through the
 * registry's `toActions` (show_pages), which land in `turn.actions`.
 *
 * An entry is `{ id, label(ctx, state), when(turn, ctx), run(turn, ctx), busyLabel?, ghost? }`.
 * Per-action UI state (copied, busy, failed) lives in the conversation
 * controller keyed by turn id — never by answer text — and reaches an entry
 * through `ctx.getState`/`ctx.setState`. `run` may return a patch; only its
 * `artifacts` are kept (on the turn and in the history).
 */
import * as m from '$lib/paraglide/messages';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { keepItem } from './cards/filter.js';
import {
  articleDraft,
  documentFilename,
  documentMarkdown,
  draftSummary,
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
 *   setArtifacts: (turnId: string, patch: import('./history/conversation-codec.js').Artifacts) => void
 * }} AnswerActionCtx `author`: the signed-in user's name for a LiaScript header's empty `author:`
 * @typedef {{
 *   id: string,
 *   label: (ctx: AnswerActionCtx, state?: ActionState) => string,
 *   when: (turn: Turn, ctx: AnswerActionCtx) => boolean,
 *   run: (turn: Turn, ctx: AnswerActionCtx) => Promise<Partial<Turn> | void>,
 *   busyLabel?: (ctx: AnswerActionCtx) => string,
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

// sourcesLost: the history cap dropped the outputs — no export without its sources
/** @param {Turn} turn */
const isDocument = (turn) =>
  turn.role === 'assistant' && !turn.pending && !turn.sourcesLost && isDocumentAnswer(turn.text);

/** @type {AnswerAction[]} */
export const ANSWER_ACTIONS = [
  {
    id: 'copy',
    label: (_ctx, state) =>
      !state ? m.termi_doc_copy() : state.ok ? m.termi_doc_copied() : m.termi_doc_copy_failed(),
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
    when: (turn, ctx) => isDocument(turn) && !!ctx.user,
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
    busyLabel: () => m.termi_doc_liascript(),
    ghost: true,
    when: (turn, ctx) => isDocument(turn) && !!ctx.user,
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
  }
];

/** The answer actions this turn offers, in button order. @param {Turn} turn @param {AnswerActionCtx} ctx */
export const actionsFor = (turn, ctx) => ANSWER_ACTIONS.filter((a) => a.when(turn, ctx));

/**
 * Runs one action: an action with a `busyLabel` is busy (and refuses a second
 * click) until it settles, a throw leaves it `failed`, a returned `artifacts`
 * patch is kept on the turn.
 * @param {Turn} turn @param {AnswerAction} action @param {AnswerActionCtx} ctx
 */
export async function runAnswerAction(turn, action, ctx) {
  const id = /** @type {string} */ (turn.id);
  const tracked = !!action.busyLabel;
  if (tracked) {
    if (ctx.getState(id, action.id)?.busy) return;
    ctx.setState(id, action.id, { busy: true });
  }
  try {
    const patch = await action.run(turn, ctx);
    if (tracked) ctx.setState(id, action.id, undefined);
    if (patch?.artifacts) ctx.setArtifacts(id, patch.artifacts);
  } catch {
    if (tracked) ctx.setState(id, action.id, { failed: true });
  }
}
