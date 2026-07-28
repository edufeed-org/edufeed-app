/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { ambToNostr, nostrToAmb } from 'amb-nostr-converter';
import { formValuesToAmbJson } from '$lib/helpers/educational/formValuesToAmbJson.js';
import { ambJsonToFormValues } from '$lib/helpers/educational/ambJsonToFormValues.js';

// reused from Task 1's formValuesToAmbJson.test.js
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

describe('ambJsonToFormValues round-trip', () => {
  it('recovers form values + concepts through the converter', () => {
    const { amb } = formValuesToAmbJson(form, values, selectedConcepts);
    const { data } = ambToNostr(amb, { pubkey: 'pk', timestamp: 0 });
    const event = {
      kind: 30142,
      pubkey: 'pk',
      content: '',
      created_at: 0,
      tags: /** @type {any} */ (data).tags
    };
    const { data: parsedAmb } = nostrToAmb(event);
    const { values: v, selectedConcepts: sc } = ambJsonToFormValues(parsedAmb, form);
    expect(v.title).toBe('Pythagoras');
    expect(v.kw).toEqual(['Geometrie', 'Mathe']);
    expect(v.free).toBe(true);
    expect(sc.about[0].id).toBe('http://w3id.org/kim/schulfaecher/s1017');
    expect(sc.about[0].labels.de).toBe('Mathematik');
  });

  it('recovers creator pubkey, amb-relation coordinate, and ext concept facet', () => {
    const hexPubkey = 'aa'.repeat(32);
    const relationPubkey = 'bb'.repeat(32);
    const relCoordinate = `30142:${relationPubkey}:some-d`;

    const extForm = {
      pubkey: 'pk',
      dTag: 'demo2',
      fields: [
        { id: 'title', type: 'text', output: 'amb:name' },
        { id: 'creators', type: 'creator', output: 'amb:creator' },
        { id: 'related', type: 'amb-relation', output: 'amb:hasPart' },
        { id: 'custom', type: 'select', vocab: { address: '39737:p:d3' }, output: 'ext' }
      ]
    };
    const extValues = {
      title: 'Test resource',
      creators: [{ pubkey: hexPubkey, name: 'Jane Doe', type: 'Person' }],
      related: [{ coordinate: relCoordinate, relayHint: 'wss://relay.example/' }]
    };
    const extSelectedConcepts = {
      custom: [{ id: 'urn:x', labels: { de: 'X' } }]
    };

    const { amb } = formValuesToAmbJson(extForm, extValues, extSelectedConcepts);
    const { data } = ambToNostr(amb, { pubkey: 'pk', timestamp: 0 });
    const event = {
      kind: 30142,
      pubkey: 'pk',
      content: '',
      created_at: 0,
      tags: /** @type {any} */ (data).tags
    };
    const { data: parsedAmb } = nostrToAmb(event);
    const { values: v, selectedConcepts: sc } = ambJsonToFormValues(parsedAmb, extForm);

    expect(v.creators[0].pubkey).toBe(hexPubkey);
    expect(v.related[0].coordinate).toBe(relCoordinate);
    expect(sc.custom[0].id).toBe('urn:x');
    expect(sc.custom[0].labels.de).toBe('X');
  });
});
