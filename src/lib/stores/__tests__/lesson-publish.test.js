/** @vitest-environment node */
// Phase 7: parts → 30023 (same d as the wrap), in order; the 30040 index only
// after every part; the describing 30142; idempotent and resumable (Review Focus 5).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';
import { ambToNostr } from 'amb-nostr-converter';
import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';

const PK = 'a'.repeat(64);
const h = vi.hoisted(() => ({
  /** @type {any} */ active: { pubkey: 'a'.repeat(64) },
  createArticle: /** @type {any} */ (null),
  createPublication: /** @type {any} */ (null),
  createResource: vi.fn(),
  loadLessonDraft: /** @type {any} */ (null)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active() {
      return h.active;
    }
  }
}));
vi.mock('$lib/stores/article-actions.svelte.js', () => ({
  createArticle: (h.createArticle = vi.fn()),
  LEARNING_MODULE_KIND: 30146
}));
vi.mock('$lib/services/publish-service.js', () => ({
  buildATagWithHint: async (/** @type {string} */ address) => ['a', address, 'wss://write.example/']
}));
vi.mock('$lib/stores/publication-actions.svelte.js', () => ({
  createPublication: (h.createPublication = vi.fn())
}));
vi.mock('$lib/stores/educational-actions.svelte.js', () => ({
  createEducationalActions: () => ({ createResource: h.createResource })
}));
vi.mock('$lib/stores/lesson-drafts.svelte.js', () => ({
  loadLessonDraft: (h.loadLessonDraft = vi.fn())
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getEducationalRelays: () => ['wss://amb.example/']
}));

const { publishLessonSeries, defaultLicence, educationalLevelOf, seriesTitle } = await import(
  '../lesson-publish.svelte.js'
);
const { withPublished } = await import('$lib/termi/lesson-state.js');

const wrapOf = (/** @type {string} */ key) =>
  nip19.naddrEncode({ kind: 31234, pubkey: PK, identifier: `lesson-c1-${key}` });
const articleNaddr = (/** @type {string} */ d, kind = 30023) =>
  nip19.naddrEncode({ kind, pubkey: PK, identifier: d, relays: ['wss://long.example/'] });
const PUB = nip19.naddrEncode({
  kind: 30040,
  pubkey: PK,
  identifier: 'series-1',
  relays: ['wss://amb.example/']
});

/** @returns {any} */
const lessonState = () => ({
  phase: 7,
  frame: { subject: 'Mathematik', topic: 'Brüche', grade: 4, schoolType: 'Grundschule' },
  competences: [
    { uri: 'https://w3id.org/lehrplan/k1', label: 'Brüche vergleichen' },
    { label: 'ohne URI' }
  ],
  didactics: {},
  plan: [],
  parts: {
    overview: { wrap: wrapOf('overview') },
    // lessons out of order: the publish order is by n
    lessons: [
      { n: 2, title: 'Stunde 2', wrap: wrapOf('lesson-2') },
      { n: 1, title: 'Stunde 1', wrap: wrapOf('lesson-1') }
    ],
    sources: { wrap: wrapOf('sources') }
  }
});

beforeEach(() => {
  h.active = { pubkey: PK };
  h.createArticle.mockReset();
  h.createPublication.mockReset();
  h.createResource.mockReset();
  h.loadLessonDraft.mockReset();
  h.loadLessonDraft.mockImplementation(async (/** @type {string} */ naddr) => {
    const d = /** @type {any} */ (nip19.decode(naddr)).data.identifier;
    return {
      title: d,
      dTag: d,
      content: d.endsWith('overview')
        ? '# Überblick\n\nIn dieser Reihe entdecken Kinder Brüche.\n\nMehr.'
        : `# ${d}\n\nText.`
    };
  });
  h.createArticle.mockImplementation(
    async (
      /** @type {any} */ _f,
      /** @type {any} */ _c,
      /** @type {any} */ _e,
      /** @type {any} */ o
    ) => ({
      naddr: articleNaddr(o.dTag, o.kind)
    })
  );
  h.createPublication.mockResolvedValue({ naddr: PUB });
  h.createResource.mockResolvedValue({ naddr: 'naddr1resource' });
});

describe('publishLessonSeries', () => {
  it('publishes the parts in order under their wrap d, then the index with ordered a tags', async () => {
    const order = /** @type {string[]} */ ([]);
    h.createPublication.mockImplementation(async () => {
      order.push('publication');
      return { naddr: PUB };
    });
    h.createArticle.mockImplementation(
      async (
        /** @type {any} */ f,
        /** @type {any} */ _c,
        /** @type {any} */ _e,
        /** @type {any} */ o
      ) => {
        order.push(o.dTag);
        expect(o.awaitPublish).toBe(true);
        expect(f.license).toBe('https://creativecommons.org/licenses/by/4.0/');
        return { naddr: articleNaddr(o.dTag) };
      }
    );
    const record = vi.fn();
    const out = await publishLessonSeries(lessonState(), { asResource: false, record });
    expect(order).toEqual([
      'lesson-c1-overview',
      'lesson-c1-lesson-1',
      'lesson-c1-lesson-2',
      'lesson-c1-sources',
      'publication'
    ]);
    const form = h.createPublication.mock.calls[0][0];
    expect(form.type).toBe('lesson-series');
    expect(form.title).toBe('Mathematik: Brüche, Klasse 4');
    expect(form.abstract).toBe('In dieser Reihe entdecken Kinder Brüche.');
    expect(form.keywords).toEqual(['Mathematik', 'Klasse 4', 'Unterrichtsreihe']);
    expect(form.subjects).toEqual([]);
    expect(form.creators).toEqual([{ name: '', type: 'Person', pubkey: PK }]);
    expect(form.parts).toEqual(
      ['overview', 'lesson-1', 'lesson-2', 'sources'].map((k) => ({
        address: `30023:${PK}:lesson-c1-${k}`,
        relay: 'wss://long.example/'
      }))
    );
    expect(out.publication).toBe(PUB);
    expect(out.parts.lessons.find((/** @type {any} */ l) => l.n === 1)?.naddr).toBe(
      articleNaddr('lesson-c1-lesson-1')
    );
    expect(record).toHaveBeenCalledWith({ publication: PUB }, undefined);
    expect(h.createResource).not.toHaveBeenCalled();
  });

  it('a relay refusing part 3: throws publish_failed:<key>, keeps the first two, never the index; a retry publishes only the rest', async () => {
    let state = lessonState();
    const record = (/** @type {any} */ rec) => (state = withPublished(state, rec));
    h.createArticle.mockImplementation(
      async (
        /** @type {any} */ _f,
        /** @type {any} */ _c,
        /** @type {any} */ _e,
        /** @type {any} */ o
      ) => {
        if (o.dTag === 'lesson-c1-lesson-2') throw new Error('publish_failed');
        return { naddr: articleNaddr(o.dTag) };
      }
    );
    const progress = vi.fn();
    await expect(
      publishLessonSeries(state, { asResource: false, record, onProgress: progress })
    ).rejects.toThrow('publish_failed:lesson-2');
    expect(h.createPublication).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith({ key: 'lesson-2', status: 'failed' });
    expect(state.parts.overview?.naddr).toBeTruthy();
    expect(state.parts.lessons.find((/** @type {any} */ l) => l.n === 1)?.naddr).toBeTruthy();
    expect(state.parts.lessons.find((/** @type {any} */ l) => l.n === 2)?.naddr).toBeUndefined();

    h.createArticle.mockClear();
    h.createArticle.mockImplementation(
      async (
        /** @type {any} */ _f,
        /** @type {any} */ _c,
        /** @type {any} */ _e,
        /** @type {any} */ o
      ) => ({
        naddr: articleNaddr(o.dTag)
      })
    );
    await publishLessonSeries(state, { asResource: false, record });
    expect(h.createArticle.mock.calls.map((/** @type {any} */ c) => c[3].dTag)).toEqual([
      'lesson-c1-lesson-2',
      'lesson-c1-sources'
    ]);
    expect(h.createPublication).toHaveBeenCalledOnce();

    // a third run has nothing left to do
    h.createArticle.mockClear();
    h.createPublication.mockClear();
    await publishLessonSeries(state, { asResource: false, record });
    expect(h.createArticle).not.toHaveBeenCalled();
    expect(h.createPublication).not.toHaveBeenCalled();
  });

  it('a part she planned but never saved is left out: the index references exactly the saved two', async () => {
    const state = lessonState();
    state.parts = {
      overview: { wrap: wrapOf('overview') },
      lessons: [
        { n: 1, title: 'Stunde 1', wrap: wrapOf('lesson-1') },
        { n: 2, title: 'Stunde 2' }
      ]
    };
    await publishLessonSeries(state, { asResource: false, conversationId: 'c1' });
    expect(h.createArticle.mock.calls.map((/** @type {any} */ c) => c[3].dTag)).toEqual([
      'lesson-c1-overview',
      'lesson-c1-lesson-1'
    ]);
    const [form, , , opts] = h.createPublication.mock.calls[0];
    expect(form.parts.map((/** @type {any} */ p) => p.address)).toEqual([
      `30023:${PK}:lesson-c1-overview`,
      `30023:${PK}:lesson-c1-lesson-1`
    ]);
    expect(opts).toEqual({ awaitPublish: true, dTag: 'lesson-c1' });
  });

  it('nothing saved at all: no_parts, nothing published', async () => {
    const state = lessonState();
    state.parts = { lessons: [{ n: 1, title: 'Stunde 1' }] };
    await expect(publishLessonSeries(state, {})).rejects.toThrow('no_parts');
    expect(h.createArticle).not.toHaveBeenCalled();
    expect(h.createPublication).not.toHaveBeenCalled();
  });

  it('index refused by every relay: not recorded; a retry publishes only the index, same d', async () => {
    let state = lessonState();
    const record = vi.fn((/** @type {any} */ rec) => (state = withPublished(state, rec)));
    h.createPublication.mockRejectedValueOnce(new Error('publish_failed'));
    await expect(
      publishLessonSeries(state, { asResource: false, record, conversationId: 'c1' })
    ).rejects.toThrow('publish_failed:publication');
    expect(state.publication).toBeUndefined();
    expect(record).not.toHaveBeenCalledWith(
      expect.objectContaining({ publication: expect.anything() }),
      'c1'
    );
    h.createArticle.mockClear();
    await publishLessonSeries(state, { asResource: false, record, conversationId: 'c1' });
    expect(h.createArticle).not.toHaveBeenCalled();
    expect(h.createPublication).toHaveBeenCalledTimes(2);
    expect(h.createPublication.mock.calls[1][3]).toEqual({ awaitPublish: true, dTag: 'lesson-c1' });
    expect(state.publication).toBe(PUB);
  });

  it('resource refused: not recorded; a retry publishes only the resource', async () => {
    let state = lessonState();
    const record = (/** @type {any} */ rec) => (state = withPublished(state, rec));
    h.createResource.mockRejectedValueOnce(new Error('publish_failed'));
    await expect(publishLessonSeries(state, { record })).rejects.toThrow('publish_failed:resource');
    expect(state.publication).toBe(PUB);
    expect(state.resource).toBeUndefined();
    expect(h.createResource.mock.calls[0][2].awaitPublish).toBe(true);
    h.createArticle.mockClear();
    h.createPublication.mockClear();
    await publishLessonSeries(state, { record });
    expect(h.createArticle).not.toHaveBeenCalled();
    expect(h.createPublication).not.toHaveBeenCalled();
    expect(h.createResource).toHaveBeenCalledTimes(2);
    expect(state.resource).toBe('naddr1resource');
  });

  it('a part saved after the series was out: published, and the index updated under its d', async () => {
    let state = lessonState();
    const record = (/** @type {any} */ rec) => (state = withPublished(state, rec));
    await publishLessonSeries(state, { asResource: false, record });
    state = {
      ...state,
      parts: { ...state.parts, summary: { wrap: wrapOf('summary') } }
    };
    h.createArticle.mockClear();
    h.createPublication.mockClear();
    await publishLessonSeries(state, { asResource: false, record });
    expect(h.createArticle.mock.calls.map((/** @type {any} */ c) => c[3].dTag)).toEqual([
      'lesson-c1-summary'
    ]);
    expect(h.createPublication.mock.calls[0][3].dTag).toBe('series-1');
    expect(h.createPublication.mock.calls[0][0].parts).toHaveLength(5);
  });

  it('a late part whose index republish fails: the stale index is unset, the next run republishes it under the same d', async () => {
    let state = lessonState();
    const record = vi.fn((/** @type {any} */ rec) => (state = withPublished(state, rec)));
    await publishLessonSeries(state, { asResource: false, record, conversationId: 'c1' });
    expect(state.publication).toBe(PUB);
    state = { ...state, parts: { ...state.parts, summary: { wrap: wrapOf('summary') } } };
    h.createPublication.mockClear().mockRejectedValueOnce(new Error('publish_failed'));
    await expect(
      publishLessonSeries(state, { asResource: false, record, conversationId: 'c1' })
    ).rejects.toThrow('publish_failed:publication');
    expect(state.publication).toBeUndefined();
    expect(state.parts.summary.naddr).toBeTruthy();
    // every part is out now; only the index was stale
    h.createArticle.mockClear();
    h.createPublication.mockResolvedValue({ naddr: PUB });
    await publishLessonSeries(state, { asResource: false, record, conversationId: 'c1' });
    expect(h.createArticle).not.toHaveBeenCalled();
    expect(h.createPublication).toHaveBeenCalledTimes(2);
    expect(h.createPublication.mock.calls[1][0].parts).toHaveLength(5);
    expect(state.publication).toBe(PUB);
  });

  it('a part re-saved after the series was out: its old naddr is dropped, so it and the index go out again', async () => {
    const { withPartWrap } = await import('$lib/termi/lesson-state.js');
    let state = lessonState();
    const record = (/** @type {any} */ rec) => (state = withPublished(state, rec));
    await publishLessonSeries(state, { asResource: false, record, conversationId: 'c1' });
    state = withPartWrap(state, 'lesson-2', wrapOf('lesson-2'));
    expect(state.parts.lessons.find((/** @type {any} */ l) => l.n === 2).naddr).toBeUndefined();
    h.createArticle.mockClear();
    h.createPublication.mockClear();
    await publishLessonSeries(state, { asResource: false, record, conversationId: 'c1' });
    expect(h.createArticle.mock.calls.map((/** @type {any} */ c) => c[3].dTag)).toEqual([
      'lesson-c1-lesson-2'
    ]);
    expect(h.createPublication).toHaveBeenCalledTimes(1);
    expect(h.createPublication.mock.calls[0][3].dTag).toBe('series-1');
  });

  it('an account switch mid-run: account_switched, nothing more signed; record gets the run conversation id', async () => {
    const record = vi.fn();
    h.createArticle.mockImplementationOnce(
      async (
        /** @type {any} */ _f,
        /** @type {any} */ _c,
        /** @type {any} */ _e,
        /** @type {any} */ o
      ) => {
        h.active = { pubkey: 'b'.repeat(64) };
        return { naddr: articleNaddr(o.dTag) };
      }
    );
    await expect(
      publishLessonSeries(lessonState(), { record, conversationId: 'c1' })
    ).rejects.toThrow('account_switched');
    expect(h.createArticle).toHaveBeenCalledTimes(1);
    expect(h.createPublication).not.toHaveBeenCalled();
    expect(h.createResource).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][1]).toBe('c1');
  });

  it('the module part gets her name in its LiaScript header', async () => {
    const state = lessonState();
    state.parts.module = { wrap: wrapOf('module') };
    h.loadLessonDraft.mockImplementation(async (/** @type {string} */ naddr) => {
      const d = /** @type {any} */ (nip19.decode(naddr)).data.identifier;
      return {
        title: d,
        dTag: d,
        content: d.endsWith('module') ? '<!--\nauthor:\n-->\n# Modul' : `# ${d}`
      };
    });
    await publishLessonSeries(state, { asResource: false, author: 'Gina' });
    const module = h.createArticle.mock.calls.find((/** @type {any} */ c) =>
      c[3].dTag.endsWith('module')
    );
    expect(module[0].content.startsWith('<!--\nauthor: Gina\n')).toBe(true);
  });

  it('the Selbstlernmodul is a kind 30146 with m/alt/L/l/t and an a to its series; the 30142 points at it too', async () => {
    const state = lessonState();
    state.parts.module = { wrap: wrapOf('module') };
    h.loadLessonDraft.mockImplementation(async (/** @type {string} */ naddr) => {
      const d = /** @type {any} */ (nip19.decode(naddr)).data.identifier;
      const content = d.endsWith('module') ? '<!--\nauthor:\nlanguage: en\n-->\n# Modul' : `# ${d}`;
      return { title: d, dTag: d, content };
    });
    await publishLessonSeries(state, { conversationId: 'c1' });
    const calls = h.createArticle.mock.calls;
    const module = calls.find((/** @type {any} */ c) => c[3].dTag.endsWith('module'));
    expect(module[3].kind).toBe(30146);
    expect(module[3].extraTags).toEqual([
      ['m', 'text/x-liascript'],
      ['alt', 'LiaScript-Kurs „lesson-c1-module“ – öffnen mit einem LiaScript-Player'],
      ['L', 'ISO-639-1'],
      ['l', 'en', 'ISO-639-1'],
      ['t', 'liascript'],
      ['a', `30040:${PK}:lesson-c1`, 'wss://write.example/']
    ]);
    // every other part stays a 30023
    expect(calls.filter((/** @type {any} */ c) => c[3].kind)).toHaveLength(1);
    expect(
      h.createPublication.mock.calls[0][0].parts.map((/** @type {any} */ p) => p.address)
    ).toContain(`30146:${PK}:lesson-c1-module`);
    expect(h.createResource.mock.calls[0][2].extraTags[1]).toEqual([
      'a',
      `30146:${PK}:lesson-c1-module`,
      'wss://long.example/'
    ]);
  });

  it('a wrap known only from the turns is published too', async () => {
    const state = lessonState();
    await publishLessonSeries(state, {
      asResource: false,
      draftWraps: { summary: wrapOf('summary') }
    });
    expect(h.createArticle.mock.calls.map((/** @type {any} */ c) => c[3].dTag)).toContain(
      'lesson-c1-summary'
    );
  });

  it('the describing 30142: AMB id = nostr:naddr of the 30040 without hints, the a marker id', async () => {
    await publishLessonSeries(lessonState(), { licence: 'CC BY-SA 4.0' });
    const [formData, variant, options] = h.createResource.mock.calls[0];
    expect(variant).toBe('amb');
    const id = 'nostr:' + nip19.naddrEncode({ kind: 30040, pubkey: PK, identifier: 'series-1' });
    expect(formData.slug).toBe(id);
    expect(formData.license).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(options).toEqual({
      extraTags: [['a', `30040:${PK}:series-1`, 'wss://amb.example/', 'id']],
      subjectOptional: true,
      awaitPublish: true
    });
    // the real serializer: d (and AMB id) = the hint-less naddr; competences with a URI as teaches
    const { data } = ambToNostr(/** @type {any} */ (convertFormDataToAMB(formData)), {
      pubkey: PK,
      timestamp: 1
    });
    const tags = /** @type {string[][]} */ (data?.tags);
    expect(tags.find((t) => t[0] === 'd')?.[1]).toBe(id);
    expect(tags.filter((t) => t[0] === 'teaches:id').map((t) => t[1])).toEqual([
      'https://w3id.org/lehrplan/k1'
    ]);
    expect(tags.find((t) => t[0] === 'educationalLevel:id')?.[1]).toBe(
      'https://w3id.org/kim/educationalLevel/level_1'
    );
  });
});

describe('helpers', () => {
  it('defaultLicence: BY-SA in the sources → CC BY-SA, else CC BY; her named licence wins', () => {
    expect(defaultLicence(lessonState(), 'Bild: CC BY-SA 4.0, Wikimedia')).toBe('CC BY-SA 4.0');
    expect(defaultLicence(lessonState(), 'CC BY 4.0')).toBe('CC BY 4.0');
    expect(defaultLicence({ ...lessonState(), licence: 'CC BY-SA 4.0' }, '')).toBe('CC BY-SA 4.0');
  });

  it('educationalLevelOf and seriesTitle', () => {
    expect(educationalLevelOf({ grade: '7' })?.[1]).toBe('Sekundarbereich I');
    expect(educationalLevelOf({})).toBeUndefined();
    expect(seriesTitle(/** @type {any} */ ({ frame: {} }))).toBe('Unterrichtsreihe');
  });
});
