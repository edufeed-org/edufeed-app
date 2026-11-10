/**
 * The lesson series' drafts while planning: each part a NIP-37 wrap (kind
 * 31234, NIP-44 to self) of the kind 30023 it will become, saved only on an
 * explicit action, on the user's write relays. A LiaScript preview is the one
 * plaintext copy (kind 30024), written only after the user confirmed.
 */
import { nip19 } from 'nostr-tools';
import { lastValueFrom, toArray } from 'rxjs';
import { manager } from '$lib/stores/accounts.svelte';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { hasNip44 } from '$lib/helpers/nip44.js';
import { unique } from '$lib/helpers/unique.js';
import { nextCreatedAt } from '$lib/helpers/replaceableUpdates.js';
import { DRAFT_WRAP_KIND, unwrapDraft, wrapDraftTemplate } from '$lib/helpers/draft-wraps.js';
import { publishEvent } from '$lib/services/publish-service.js';
import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
import { fetchEvents } from '$lib/loaders/base.js';
import {
  ARTICLE_KIND,
  buildArticleTags,
  createArticle
} from '$lib/stores/article-actions.svelte.js';
import { draftSummary } from '$lib/components/assistant/document-export.js';
import { partKey } from '$lib/termi/lesson-state.js';

/** @typedef {import('$lib/termi/lesson-state.js').LessonPartText} LessonPartText */

/** @param {string} conversationId @param {{ kind: string, n?: number }} part */
export const lessonDraftDTag = (conversationId, part) =>
  `lesson-${conversationId}-${partKey(part)}`;

/** @param {LessonPartText} part */
const articleFields = (part) => ({
  title: part.title,
  content: part.text,
  summary: draftSummary(part.text),
  image: ''
});

/**
 * Saves one part as an encrypted wrap; the same conversation and part replace the earlier wrap.
 * @param {{ conversationId: string, part: LessonPartText }} args
 * @returns {Promise<{ naddr: string, dTag: string }>}
 */
export async function saveLessonDraft({ conversationId, part }) {
  const account = manager.active;
  if (!account) throw new Error('not logged in');
  if (!hasNip44(account.signer)) throw new Error('signer has no nip44');
  const dTag = lessonDraftDTag(conversationId, part);
  // the template createArticle would sign later: its tags, the client tag from the factory
  const draft = await createAppEventFactory().build({
    kind: ARTICLE_KIND,
    content: part.text,
    tags: buildArticleTags(articleFields(part), dTag)
  });
  const wrap = await wrapDraftTemplate(draft, account.signer, account.pubkey);
  wrap.created_at = nextCreatedAt(eventStore.getReplaceable(DRAFT_WRAP_KIND, account.pubkey, dTag));
  const signed = await account.signEvent(wrap);
  // no tagged users and no app relays for 31234: the author's write relays
  const result = await publishEvent(signed, [], {});
  if (!result.success) throw new Error('publish_failed');
  eventStore.add(signed);
  const naddr = nip19.naddrEncode({
    kind: DRAFT_WRAP_KIND,
    pubkey: account.pubkey,
    identifier: dTag,
    relays: result.acceptedRelays.slice(0, 3)
  });
  return { naddr, dTag };
}

/**
 * A saved part, decrypted; null when it is not the user's, cannot be found or
 * the signer cannot decrypt it (no NIP-44, other key, tampered).
 * @param {string} naddr @returns {Promise<{ title: string, content: string, dTag: string } | null>}
 */
export async function loadLessonDraft(naddr) {
  const account = manager.active;
  if (!account || !hasNip44(account.signer)) return null;
  /** @type {nip19.AddressPointer} */
  let ptr;
  try {
    const decoded = nip19.decode(naddr);
    if (decoded.type !== 'naddr') return null;
    ptr = decoded.data;
  } catch {
    return null;
  }
  if (ptr.kind !== DRAFT_WRAP_KIND || ptr.pubkey !== account.pubkey) return null;
  let event = eventStore.getReplaceable(DRAFT_WRAP_KIND, ptr.pubkey, ptr.identifier);
  if (!event) {
    const relays = unique([...(ptr.relays ?? []), ...(await getWriteRelays(ptr.pubkey))]);
    const filter = { kinds: [DRAFT_WRAP_KIND], authors: [ptr.pubkey], '#d': [ptr.identifier] };
    const found = await lastValueFrom(fetchEvents(relays, filter).pipe(toArray()));
    // the newest copy: an older one would show a stale draft
    event = found.reduce(
      (/** @type {any} */ a, /** @type {any} */ b) => (!a || b.created_at > a.created_at ? b : a),
      null
    );
  }
  const draft = await unwrapDraft(event, account.signer, account.pubkey);
  if (!draft) return null;
  const title = draft.tags.find((t) => t[0] === 'title')?.[1] ?? '';
  return { title, content: draft.content, dTag: ptr.identifier };
}

/**
 * The plaintext copy LiaScript needs: an unlisted kind 30024 of the part. Only
 * after the user confirmed the warning; the wrap stays the source of truth.
 * @param {LessonPartText} part @returns {Promise<string>} its naddr
 */
export async function previewAsPlaintext(part) {
  const { naddr } = await createArticle(articleFields(part), undefined, null, {
    draft: true,
    awaitPublish: true
  });
  return naddr;
}
