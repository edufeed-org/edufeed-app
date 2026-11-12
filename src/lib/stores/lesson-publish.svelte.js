/**
 * Phase 7 of the lesson series: every part (an encrypted NIP-37 wrap until
 * now) becomes a kind 30023 under the wrap's own `d` — the Selbstlernmodul a
 * kind 30146 learning module (wiki article edufeed-learning-module) — then the series a kind
 * 30040 (`type` lesson-series, the parts' `a` tags in order), then — when
 * she wants it findable — a kind 30142 that describes the 30040.
 *
 * Sequential and resumable: every publish is recorded at once (`record`) and
 * only after a relay accepted it, a re-run publishes only what has no naddr
 * yet, and the index never goes out before every saved part has one. A part
 * she never saved is left out. A failure throws `publish_failed:<key>`.
 */
import { nip19 } from 'nostr-tools';
import { manager } from '$lib/stores/accounts.svelte';
import { createArticle, LEARNING_MODULE_KIND } from '$lib/stores/article-actions.svelte.js';
import { buildATagWithHint } from '$lib/services/publish-service.js';
import { createPublication } from '$lib/stores/publication-actions.svelte.js';
import { createEducationalActions } from '$lib/stores/educational-actions.svelte.js';
import { loadLessonDraft } from '$lib/stores/lesson-drafts.svelte.js';
import { getEducationalRelays } from '$lib/helpers/relay-helper.js';
import { draftSummary, fillAuthor } from '$lib/components/assistant/document-export.js';
import { partsInOrder, withPublished } from '$lib/termi/lesson-state.js';

/** @typedef {import('$lib/termi/lesson-state.js').LessonState} LessonState */
/** @typedef {import('$lib/termi/lesson-state.js').PublishedRecord} PublishedRecord */

export const LICENCES = /** @type {const} */ ({
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/'
});
/** @typedef {keyof typeof LICENCES} Licence */

/**
 * CC BY-SA when an adapted source is BY-SA, else CC BY; a licence she already
 * named in the conversation wins.
 * shortcut: the state keeps no per-source licence list, so "BY-SA" anywhere in the
 * sources part decides; upgrade when sources carry their licence in the state.
 * @param {LessonState | null | undefined} state @param {string} [sourcesText]
 * @returns {Licence}
 */
export function defaultLicence(state, sourcesText = '') {
  if (state?.licence && state.licence in LICENCES) return /** @type {Licence} */ (state.licence);
  return /BY-SA/i.test(sourcesText) ? 'CC BY-SA 4.0' : 'CC BY 4.0';
}

/** "Mathematik: Brüche, Klasse 6" from the frame. @param {LessonState} state */
export function seriesTitle(state) {
  const f = state.frame ?? {};
  const head = [f.subject, f.topic].filter((x) => typeof x === 'string' && x.trim()).join(': ');
  const grade = f.grade !== undefined && f.grade !== '' ? `Klasse ${f.grade}` : '';
  return [head, grade].filter(Boolean).join(', ') || 'Unterrichtsreihe';
}

/** The first prose paragraph of a Markdown text (no heading, no comment), ≤ 500 chars. @param {string} text */
export const firstParagraph = (text) =>
  (
    String(text ?? '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('#') && !p.startsWith('|')) ?? ''
  ).slice(0, 500);

const LEVELS = [
  ['https://w3id.org/kim/educationalLevel/level_1', 'Primarbereich'],
  ['https://w3id.org/kim/educationalLevel/level_2', 'Sekundarbereich I'],
  ['https://w3id.org/kim/educationalLevel/level_3', 'Sekundarbereich II']
];
/** KIM educational level from the frame's school type or grade; undefined when unclear. @param {Record<string, any>} frame */
export function educationalLevelOf(frame) {
  if (/grundschule/i.test(String(frame?.schoolType ?? ''))) return LEVELS[0];
  const grade = parseInt(String(frame?.grade ?? ''), 10);
  if (!grade) return undefined;
  return grade <= 4 ? LEVELS[0] : grade <= 10 ? LEVELS[1] : grade <= 13 ? LEVELS[2] : undefined;
}

/** `30023:<pubkey>:<d>` and the first relay hint of an naddr. @param {string} naddr */
function addressOf(naddr) {
  const { data } = /** @type {{ data: nip19.AddressPointer }} */ (nip19.decode(naddr));
  return {
    address: `${data.kind}:${data.pubkey}:${data.identifier}`,
    relay: data.relays?.[0] ?? ''
  };
}

/** The LiaScript header's `language:`, else 'de'. @param {string} content */
const liaLanguage = (content) =>
  /^\s*language:\s*([a-z]{2})\b/im
    .exec(/^\s*<!--([\s\S]*?)-->/.exec(content)?.[1] ?? '')?.[1]
    ?.toLowerCase() ?? 'de';

/**
 * @param {LessonState} state
 * @param {{
 *   draftWraps?: Record<string, string>,
 *   asResource?: boolean,
 *   licence?: Licence,
 *   author?: string,
 *   conversationId?: string,
 *   onProgress?: (p: { key: string, status: 'busy'|'done'|'failed' }) => void,
 *   record?: (rec: PublishedRecord, conversationId?: string) => void
 * }} [options] `draftWraps`: the turns' wraps (the state's win); `conversationId`: the
 *   index's stable `d` (`lesson-<id>`), so a retry replaces the same series; `record`: keeps
 *   each publish in the conversation at once, so a throw leaves a resumable state (it gets
 *   the run's `conversationId`, so a run outliving its conversation records nothing).
 *   An account switch mid-run throws `account_switched` before the next signature.
 * @returns {Promise<LessonState>}
 */
export async function publishLessonSeries(state, options = {}) {
  const { draftWraps = {}, asResource = true, licence = 'CC BY 4.0', author = '' } = options;
  const onProgress = options.onProgress ?? (() => {});
  const account = manager.active;
  if (!account) throw new Error('not logged in');
  const sameAccount = () => {
    if (manager.active?.pubkey !== account.pubkey) throw new Error('account_switched');
  };
  // a part she planned but never saved is left out (the modal lists it as missing)
  const parts = partsInOrder(state, draftWraps).filter((p) => p.wrap || p.naddr);
  if (!parts.length) throw new Error('no_parts');

  const license = LICENCES[licence] ?? LICENCES['CC BY 4.0'];
  let s = state;
  /** @param {PublishedRecord} rec */
  const keep = (rec) => {
    s = withPublished(s, rec);
    options.record?.(rec, options.conversationId);
  };
  /** @type {Record<string, string>} */
  const texts = {};
  let publishedNow = false;
  // deterministic: the module can point at its series before the index exists
  const indexDTag = state.publication
    ? /** @type {{ data: nip19.AddressPointer }} */ (nip19.decode(state.publication)).data
        .identifier
    : options.conversationId
      ? `lesson-${options.conversationId}`
      : undefined;

  for (const part of parts) {
    if (part.naddr) {
      onProgress({ key: part.key, status: 'done' });
      continue;
    }
    onProgress({ key: part.key, status: 'busy' });
    try {
      const draft = await loadLessonDraft(/** @type {string} */ (part.wrap));
      if (!draft) throw new Error('draft unreadable');
      texts[part.key] = draft.content;
      // the module's LiaScript header leaves `author:` empty: her name, as the preview does
      const content = part.key === 'module' ? fillAuthor(draft.content, author) : draft.content;
      const title = draft.title || part.title;
      const module =
        part.key === 'module'
          ? {
              kind: LEARNING_MODULE_KIND,
              extraTags: [
                ['m', 'text/x-liascript'],
                ['alt', `LiaScript-Kurs „${title}“ – öffnen mit einem LiaScript-Player`],
                ['L', 'ISO-639-1'],
                ['l', liaLanguage(content), 'ISO-639-1'],
                ['t', 'liascript'],
                ...(indexDTag
                  ? [await buildATagWithHint(`30040:${account.pubkey}:${indexDTag}`)]
                  : [])
              ]
            }
          : {};
      sameAccount();
      const { naddr } = await createArticle(
        { title, content, summary: draftSummary(content), image: '', license },
        undefined,
        null,
        { awaitPublish: true, dTag: draft.dTag, ...module }
      );
      keep({ key: part.key, naddr });
      publishedNow = true;
      onProgress({ key: part.key, status: 'done' });
    } catch (err) {
      onProgress({ key: part.key, status: 'failed' });
      if (/** @type {Error} */ (err)?.message === 'account_switched') throw err;
      throw new Error(`publish_failed:${part.key}`, { cause: err });
    }
  }

  const ordered = partsInOrder(s, draftWraps).filter((p) => p.wrap || p.naddr);
  // the index only once every saved part is out
  if (ordered.some((p) => !p.naddr)) throw new Error('publish_failed:parts');
  const title = seriesTitle(s);
  const f = s.frame ?? {};
  const keywords = [f.subject, f.grade !== undefined && `Klasse ${f.grade}`, 'Unterrichtsreihe']
    .filter((k) => typeof k === 'string' && k.trim())
    .map(String);
  const overview = ordered.find((p) => p.key === 'overview');
  if (overview && texts.overview === undefined && overview.wrap)
    texts.overview = (await loadLessonDraft(overview.wrap))?.content ?? '';
  const abstract = firstParagraph(texts.overview ?? '');
  const creators = [
    { name: author, type: /** @type {'Person'} */ ('Person'), pubkey: account.pubkey }
  ];

  // a part published in this run (one saved later) updates the index under the same d
  if (!s.publication || publishedNow) {
    onProgress({ key: 'publication', status: 'busy' });
    // the old index lacks the new part: unset until the new one is out, so a failure here is retried
    if (s.publication) keep({ publication: undefined });
    try {
      sameAccount();
      const { naddr } = await createPublication(
        {
          title,
          abstract,
          creators,
          keywords,
          // no DeStatis concept for a school subject: left empty
          subjects: [],
          license,
          inLanguage: 'de',
          type: 'lesson-series',
          parts: ordered.map((p) => addressOf(/** @type {string} */ (p.naddr)))
        },
        undefined,
        null,
        { awaitPublish: true, dTag: indexDTag }
      );
      keep({ publication: naddr });
      onProgress({ key: 'publication', status: 'done' });
    } catch (err) {
      onProgress({ key: 'publication', status: 'failed' });
      if (/** @type {Error} */ (err)?.message === 'account_switched') throw err;
      throw new Error('publish_failed:publication', { cause: err });
    }
  }

  if (asResource && !s.resource) {
    onProgress({ key: 'resource', status: 'busy' });
    try {
      const { data } = /** @type {{ data: nip19.AddressPointer }} */ (
        nip19.decode(/** @type {string} */ (s.publication))
      );
      // the AMB id: the 30040's naddr without relay hints
      const id =
        'nostr:' +
        nip19.naddrEncode({ kind: data.kind, pubkey: data.pubkey, identifier: data.identifier });
      const level = educationalLevelOf(f);
      const teaches = (s.competences ?? [])
        .filter((c) => c?.uri)
        .map((c) => ({ id: c.uri, prefLabel: { de: c.label } }));
      const lrt = { id: 'https://w3id.org/kim/hcrt/lesson_plan', label: 'Unterrichtsplanung' };
      const formData = /** @type {any} */ ({
        name: title,
        description: abstract || title,
        slug: id,
        learningResourceType: lrt.id,
        learningResourceTypeLabel: lrt.label,
        learningResourceTypes: [lrt.id],
        learningResourceTypeLabels: [lrt],
        about: [],
        aboutLabels: [],
        inLanguage: 'de',
        license,
        creators,
        keywords,
        files: [],
        ...(level
          ? {
              educationalLevels: [level[0]],
              educationalLevelLabels: [{ id: level[0], label: level[1] }]
            }
          : {}),
        ...(teaches.length ? { teaches } : {})
      });
      const marker = [
        'a',
        `${data.kind}:${data.pubkey}:${data.identifier}`,
        getEducationalRelays()[0] ?? '',
        'id'
      ];
      // the series' course: the metadata points at it too (no marker, it is not the id)
      const course = ordered.find((p) => p.key === 'module')?.naddr;
      const courseTag = course && addressOf(course);
      sameAccount();
      const { naddr } = await createEducationalActions().createResource(formData, 'amb', {
        extraTags: courseTag ? [marker, ['a', courseTag.address, courseTag.relay]] : [marker],
        subjectOptional: true,
        awaitPublish: true
      });
      keep({ resource: naddr });
      onProgress({ key: 'resource', status: 'done' });
    } catch (err) {
      onProgress({ key: 'resource', status: 'failed' });
      if (/** @type {Error} */ (err)?.message === 'account_switched') throw err;
      throw new Error('publish_failed:resource', { cause: err });
    }
  }
  return s;
}
