/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { ambToNostr } from 'amb-nostr-converter';
import { formValuesToAmbJson } from '$lib/helpers/educational/formValuesToAmbJson.js';

const form = {
  pubkey: 'pk',
  dTag: 'demo',
  fields: [
    { id: 'title', type: 'text', output: 'amb:name' },
    { id: 'desc', type: 'textarea', output: 'amb:description' },
    { id: 'url', type: 'url', output: 'amb:id' },
    { id: 'lang', type: 'text', output: 'amb:inLanguage' },
    { id: 'kw', type: 'text-array', output: 'amb:keywords' },
    { id: 'about', type: 'select', vocab: { address: '39737:p:d' }, output: 'amb:about' },
    {
      id: 'lrt',
      type: 'select',
      vocab: { address: '39737:p:d2' },
      output: 'amb:learningResourceType'
    },
    { id: 'lic', type: 'select', output: 'amb:license' },
    { id: 'free', type: 'checkbox', output: 'amb:isAccessibleForFree' },
    { id: 'creators', type: 'creator', output: 'amb:creator' },
    { id: 'img', type: 'url', output: 'amb:image' }
  ]
};
const values = {
  title: 'Pythagoras',
  desc: 'A video',
  url: 'https://oer.example/res1',
  lang: 'de',
  kw: ['Geometrie', 'Mathe'],
  lic: 'https://creativecommons.org/licenses/by/4.0/',
  free: 'true',
  creators: [{ name: 'Jane Doe', type: 'Person' }],
  img: 'https://img.example/1.png'
};
const selectedConcepts = {
  about: [{ id: 'http://w3id.org/kim/schulfaecher/s1017', labels: { de: 'Mathematik' } }],
  lrt: [{ id: 'https://w3id.org/kim/hcrt/video', labels: { de: 'Video' } }]
};

/** @param {string[][]} tags */
const norm = (tags) =>
  tags
    .filter((t) => t[0] !== 'd')
    .map((t) => t[0] + '\t' + (t[1] ?? ''))
    .sort();

describe('formValuesToAmbJson → ambToNostr golden', () => {
  it('produces the NIP-AMB AMB-core tag set', () => {
    const { amb } = formValuesToAmbJson(form, values, selectedConcepts);
    const { success, data } = ambToNostr(amb, { pubkey: 'pk', timestamp: 0 });
    expect(success).toBe(true);
    const got = norm(/** @type {any} */ (data).tags);
    // the golden set (matches the converter + the retired buildAMBResourceTags, minus the d tag)
    expect(got).toEqual([
      'about:id\thttp://w3id.org/kim/schulfaecher/s1017',
      'about:prefLabel:de\tMathematik',
      'about:type\tConcept',
      'creator:name\tJane Doe',
      'creator:type\tPerson',
      'description\tA video',
      'image\thttps://img.example/1.png',
      'inLanguage\tde',
      'isAccessibleForFree\ttrue',
      'learningResourceType:id\thttps://w3id.org/kim/hcrt/video',
      'learningResourceType:prefLabel:de\tVideo',
      'learningResourceType:type\tConcept',
      'license:id\thttps://creativecommons.org/licenses/by/4.0/',
      'name\tPythagoras',
      't\tGeometrie',
      't\tMathe',
      'type\tLearningResource'
    ]);
  });
  it('emits a nostr p-tag for a creator with a pubkey (id = nostr:npub…), no creator:* for them', () => {
    const f2 = {
      ...form,
      fields: [
        { id: 'title', type: 'text', output: 'amb:name' },
        { id: 'creators', type: 'creator', output: 'amb:creator' }
      ]
    };
    const { amb } = formValuesToAmbJson(
      f2,
      {
        title: "Bob's Resource",
        creators: [{ name: 'Bob', type: 'Person', pubkey: 'aa'.repeat(32) }]
      },
      {}
    );
    expect(amb.creator[0].id).toMatch(/^nostr:npub1/);
    const { data } = ambToNostr(amb, { pubkey: 'pk', timestamp: 0 });
    /** @type {string[][]} */
    const tags = /** @type {any} */ (data).tags;
    expect(tags.some((t) => t[0] === 'p' && t[3] === 'creator')).toBe(true);
    expect(tags.some((t) => t[0] === 'creator:name')).toBe(false);
  });
  it('form ext fields map to amb.ext[formDTag][fieldId]', () => {
    const f3 = {
      pubkey: 'pk',
      dTag: 'myform',
      fields: [{ id: 'facet', type: 'select', vocab: { address: '39737:p:d' }, output: 'ext' }]
    };
    const { amb } = formValuesToAmbJson(f3, {}, { facet: [{ id: 'urn:x', labels: { de: 'X' } }] });
    expect(amb.ext.myform.facet).toEqual([
      { id: 'urn:x', type: 'Concept', prefLabel: { de: 'X' } }
    ]);
  });
  it('returns external-urls separately (Nostr-native r-tags, not an AMB property)', () => {
    const f4 = {
      pubkey: 'pk',
      dTag: 'd',
      fields: [{ id: 'refs', type: 'external-urls', output: 'amb:refs' }]
    };
    const { extras } = formValuesToAmbJson(f4, { refs: ['https://a.example'] }, {});
    expect(extras.externalUrls).toEqual(['https://a.example']);
  });
});

describe('formValuesToAmbJson isAccessibleForFree tag emission', () => {
  const f5 = {
    pubkey: 'pk',
    dTag: 'd',
    fields: [
      { id: 'title', type: 'text', output: 'amb:name' },
      { id: 'free', type: 'checkbox', output: 'amb:isAccessibleForFree' }
    ]
  };
  const tagFor = (/** @type {string | undefined} */ rawFreeValue) => {
    const values = { title: 'Res', ...(rawFreeValue !== undefined && { free: rawFreeValue }) };
    const { amb } = formValuesToAmbJson(f5, values, {});
    const { data } = ambToNostr(amb, { pubkey: 'pk', timestamp: 0 });
    return /** @type {any} */ (data).tags.find(
      (/** @type {string[]} */ t) => t[0] === 'isAccessibleForFree'
    );
  };

  it('omits the tag when the field is untouched (empty string, as FormRenderer initializes it)', () => {
    expect(tagFor('')).toBeUndefined();
  });

  it('omits the tag when the field is absent from values entirely', () => {
    expect(tagFor(undefined)).toBeUndefined();
  });

  it('emits ["isAccessibleForFree","true"] when explicitly checked', () => {
    expect(tagFor('true')).toEqual(['isAccessibleForFree', 'true']);
  });

  it('emits ["isAccessibleForFree","false"] when explicitly unchecked after being touched', () => {
    expect(tagFor('false')).toEqual(['isAccessibleForFree', 'false']);
  });
});
