/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { resolveEmitter } from '$lib/helpers/forms/amb-emitters.js';

/** @param {any} [over] */
const ctx = (over = {}) =>
  /** @type {any} */ ({
    field: { id: 'x', type: 'text', options: {} },
    prop: '',
    formDTag: 'amb-basic',
    defaultLang: 'de',
    ...over
  });
/** @param {string[][]} tags */
const evt = (tags) =>
  /** @type {any} */ ({ kind: 30142, pubkey: 'pk', content: '', created_at: 0, tags });

describe('scalar emitter', () => {
  it('emits and parses a flat scalar', () => {
    const field = /** @type {any} */ ({
      id: 'title',
      type: 'text',
      output: 'amb:name',
      options: {}
    });
    const em = resolveEmitter(field);
    expect(em.emit('Hello', ctx({ field, prop: 'name' }))).toEqual([['name', 'Hello']]);
    expect(em.parse(evt([['name', 'Hello']]), ctx({ field, prop: 'name' })).value).toBe('Hello');
  });
  it('repeats a tag per array element (inLanguage)', () => {
    const field = /** @type {any} */ ({
      id: 'lang',
      type: 'text',
      output: 'amb:inLanguage',
      options: {}
    });
    const em = resolveEmitter(field);
    expect(em.emit(['de', 'en'], ctx({ field, prop: 'inLanguage' }))).toEqual([
      ['inLanguage', 'de'],
      ['inLanguage', 'en']
    ]);
  });
});

describe('boolean / description / dtag / license emitters', () => {
  it('boolean isAccessibleForFree', () => {
    const field = /** @type {any} */ ({
      id: 'free',
      type: 'checkbox',
      output: 'amb:isAccessibleForFree',
      options: {}
    });
    const em = resolveEmitter(field);
    expect(em.emit(true, ctx({ field, prop: 'isAccessibleForFree' }))).toEqual([
      ['isAccessibleForFree', 'true']
    ]);
    expect(em.emit('false', ctx({ field, prop: 'isAccessibleForFree' }))).toEqual([
      ['isAccessibleForFree', 'false']
    ]);
    expect(
      em.parse(evt([['isAccessibleForFree', 'true']]), ctx({ field, prop: 'isAccessibleForFree' }))
        .value
    ).toBe(true);
  });
  it('description emits description + content marker', () => {
    const field = /** @type {any} */ ({
      id: 'desc',
      type: 'textarea',
      output: 'amb:description',
      options: {}
    });
    const em = resolveEmitter(field);
    // description emitter returns the description tag AND a sentinel ['content', v]
    // that buildAMBResourceTags lifts into the event content field.
    expect(em.emit('A video', ctx({ field, prop: 'description' }))).toEqual([
      ['description', 'A video'],
      ['content', 'A video']
    ]);
  });
  it('id maps to d tag', () => {
    const field = /** @type {any} */ ({ id: 'ident', type: 'text', output: 'amb:id', options: {} });
    const em = resolveEmitter(field);
    expect(em.emit('https://oer.example/1', ctx({ field, prop: 'id' }))).toEqual([
      ['d', 'https://oer.example/1']
    ]);
  });
  it('license maps to license:id', () => {
    const field = /** @type {any} */ ({
      id: 'lic',
      type: 'select',
      output: 'amb:license',
      options: {}
    });
    const em = resolveEmitter(field);
    expect(
      em.emit('https://creativecommons.org/licenses/by/4.0/', ctx({ field, prop: 'license' }))
    ).toEqual([['license:id', 'https://creativecommons.org/licenses/by/4.0/']]);
  });
});

describe('concept emitter (NIP-AMB compliant — no a-tag, multi-lang)', () => {
  const field = /** @type {any} */ ({
    id: 'about',
    type: 'select',
    output: 'amb:about',
    vocab: { address: '39737:p:d', relay: 'wss://r' },
    options: {}
  });
  const concepts = [
    {
      id: 'http://w3id.org/kim/schulfaecher/s1017',
      nostrCoord: '39738:p:s1017',
      relay: 'wss://r',
      labels: { de: 'Mathematik', en: 'Maths' }
    }
  ];
  it('emits :id / :prefLabel:<lang> (all langs) / :type, and NO a-tag', () => {
    const tags = resolveEmitter(field).emit(concepts, ctx({ field, prop: 'about' }));
    expect(tags).toEqual([
      ['about:id', 'http://w3id.org/kim/schulfaecher/s1017'],
      ['about:prefLabel:de', 'Mathematik'],
      ['about:prefLabel:en', 'Maths'],
      ['about:type', 'Concept']
    ]);
    expect(tags.some((t) => t[0] === 'a')).toBe(false);
  });
  it('parses concepts back by external URI (no a-tag reliance)', () => {
    const parsed = /** @type {any} */ (
      resolveEmitter(field).parse(
        evt([
          ['about:id', 'http://w3id.org/kim/schulfaecher/s1017'],
          ['about:prefLabel:de', 'Mathematik'],
          ['about:type', 'Concept']
        ]),
        ctx({ field, prop: 'about' })
      )
    );
    expect(parsed.value).toEqual(['http://w3id.org/kim/schulfaecher/s1017']);
    expect(parsed.concepts[0].id).toBe('http://w3id.org/kim/schulfaecher/s1017');
    expect(parsed.concepts[0].labels.de).toBe('Mathematik');
  });
});

describe('keywords emitter (t tags)', () => {
  const field = /** @type {any} */ ({
    id: 'kw',
    type: 'text-array',
    output: 'amb:keywords',
    options: {}
  });
  it('emits t tags and parses them back', () => {
    const em = resolveEmitter(field);
    expect(em.emit(['Pythagoras', 'Geometrie'], ctx({ field, prop: 'keywords' }))).toEqual([
      ['t', 'Pythagoras'],
      ['t', 'Geometrie']
    ]);
    expect(
      em.parse(
        evt([
          ['t', 'Pythagoras'],
          ['t', 'Geometrie']
        ]),
        ctx({ field, prop: 'keywords' })
      ).value
    ).toEqual(['Pythagoras', 'Geometrie']);
  });
});

describe('ext emitter (colon-free form-d-tag namespace)', () => {
  const field = /** @type {any} */ ({
    id: 'bistum',
    type: 'select',
    output: 'ext',
    vocab: { address: '39737:p:d', relay: 'wss://r' },
    options: {}
  });
  it('namespaces by the form d-tag, not by pubkey/coord', () => {
    const concepts = [
      {
        id: 'https://w3id.org/kim/ekw/bistum/hannover',
        nostrCoord: '39738:p:h',
        relay: '',
        labels: { de: 'Hannover' }
      }
    ];
    const tags = resolveEmitter(field).emit(
      concepts,
      ctx({ field, prop: '', formDTag: 'ekw-full' })
    );
    expect(tags).toEqual([
      ['ext:ekw-full:bistum:id', 'https://w3id.org/kim/ekw/bistum/hannover'],
      ['ext:ekw-full:bistum:prefLabel:de', 'Hannover'],
      ['ext:ekw-full:bistum:type', 'Concept']
    ]);
    expect(tags.some((t) => t[0] === 'a')).toBe(false);
  });
});
