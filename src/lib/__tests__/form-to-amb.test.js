/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildAMBResourceTags,
  parseAMBResourceForForm,
  getFormReferenceFromResource
} from '../helpers/form-to-amb.js';

describe('buildAMBResourceTags', () => {
  const formRelay = 'wss://relay.example';
  const baseForm = {
    pubkey: 'edupub',
    dTag: 'amb-basic',
    fields: [
      { id: 'name', type: 'text', label: 'Name', output: 'amb:name' },
      {
        id: 'description',
        type: 'textarea',
        label: 'Beschreibung',
        output: 'amb:description'
      },
      {
        id: 'about',
        type: 'select',
        label: 'Fach',
        output: 'amb:about',
        vocab: { address: '39737:edupub:schulfaecher', relay: 'wss://vocab.example' }
      },
      {
        id: 'kompetenz',
        type: 'select',
        label: 'Kompetenz',
        output: 'ext',
        vocab: { address: '39737:mbi:komp', relay: 'wss://vocab.example' }
      },
      { id: 'klassenstufe', type: 'number', label: 'Klasse', output: 'ext' }
    ]
  };

  const values = {
    name: 'Pythagoras-Video',
    description: 'Ein Video zum Satz des Pythagoras.',
    about: ['https://w3id.org/kim/schulfaecher/s1017'],
    kompetenz: ['https://example.org/komp/arg'],
    klassenstufe: '7'
  };

  const selectedConcepts = {
    about: [
      {
        id: 'https://w3id.org/kim/schulfaecher/s1017',
        nostrCoord: '39737:edupub:s1017',
        relay: 'wss://vocab.example',
        labels: { de: 'Mathematik', en: 'Mathematics' }
      }
    ],
    kompetenz: [
      {
        id: 'https://example.org/komp/arg',
        nostrCoord: '39737:mbi:arg',
        relay: 'wss://vocab.example',
        labels: { de: 'Argumentieren' }
      }
    ]
  };

  it('emits amb:name and amb:description as plain tags', () => {
    const tags = buildAMBResourceTags({ form: baseForm, formRelay, values, selectedConcepts });
    expect(tags).toContainEqual(['name', 'Pythagoras-Video']);
    expect(tags).toContainEqual(['description', 'Ein Video zum Satz des Pythagoras.']);
  });

  it('emits amb:about as about:id / about:prefLabel:de / about:type tags', () => {
    const tags = buildAMBResourceTags({ form: baseForm, formRelay, values, selectedConcepts });
    expect(tags).toContainEqual(['about:id', 'https://w3id.org/kim/schulfaecher/s1017']);
    expect(tags).toContainEqual(['about:prefLabel:de', 'Mathematik']);
    expect(tags).toContainEqual(['about:prefLabel:en', 'Mathematics']);
    expect(tags).toContainEqual(['about:type', 'Concept']);
  });

  it('dual-emits an a-tag for each concept-valued amb field', () => {
    const tags = buildAMBResourceTags({ form: baseForm, formRelay, values, selectedConcepts });
    expect(tags).toContainEqual(['a', '39737:edupub:s1017', 'wss://vocab.example', 'about']);
  });

  it('emits ext tags namespaced by the form coordinate for concept-valued ext fields', () => {
    const tags = buildAMBResourceTags({ form: baseForm, formRelay, values, selectedConcepts });
    expect(tags).toContainEqual([
      'ext:30168:edupub:amb-basic:kompetenz:id',
      'https://example.org/komp/arg'
    ]);
    expect(tags).toContainEqual([
      'ext:30168:edupub:amb-basic:kompetenz:prefLabel:de',
      'Argumentieren'
    ]);
    expect(tags).toContainEqual(['ext:30168:edupub:amb-basic:kompetenz:type', 'Concept']);
    expect(tags).toContainEqual(['a', '39737:mbi:arg', 'wss://vocab.example', 'ext:kompetenz']);
  });

  it('emits a flat ext tag (no :id sub-path) for scalar ext fields', () => {
    const tags = buildAMBResourceTags({ form: baseForm, formRelay, values, selectedConcepts });
    expect(tags).toContainEqual(['ext:30168:edupub:amb-basic:klassenstufe', '7']);
  });

  it('emits the informative form back-reference a-tag', () => {
    const tags = buildAMBResourceTags({ form: baseForm, formRelay, values, selectedConcepts });
    expect(tags).toContainEqual(['a', '30168:edupub:amb-basic', 'wss://relay.example', 'form']);
  });

  it('round-trips via parseAMBResourceForForm (restores values + selectedConcepts)', () => {
    const tags = buildAMBResourceTags({ form: baseForm, formRelay, values, selectedConcepts });
    const event = {
      id: 'evt',
      pubkey: 'author',
      kind: 30142,
      created_at: 0,
      sig: '',
      content: '',
      tags: [['d', 'resource-id'], ...tags]
    };

    const { values: v, selectedConcepts: sc } = parseAMBResourceForForm(event, baseForm);

    expect(v.name).toBe('Pythagoras-Video');
    expect(v.description).toBe('Ein Video zum Satz des Pythagoras.');
    expect(v.about).toEqual(['https://w3id.org/kim/schulfaecher/s1017']);
    expect(v.kompetenz).toEqual(['https://example.org/komp/arg']);
    expect(v.klassenstufe).toBe('7');

    expect(sc.about).toHaveLength(1);
    expect(sc.about[0].id).toBe('https://w3id.org/kim/schulfaecher/s1017');
    expect(sc.about[0].nostrCoord).toBe('39737:edupub:s1017');
    expect(sc.about[0].relay).toBe('wss://vocab.example');
    expect(sc.about[0].labels.de).toBe('Mathematik');
    expect(sc.about[0].labels.en).toBe('Mathematics');

    expect(sc.kompetenz).toHaveLength(1);
    expect(sc.kompetenz[0].id).toBe('https://example.org/komp/arg');
    expect(sc.kompetenz[0].nostrCoord).toBe('39737:mbi:arg');
    expect(sc.kompetenz[0].labels.de).toBe('Argumentieren');
  });

  it('getFormReferenceFromResource extracts the form back-reference a-tag', () => {
    const tags = buildAMBResourceTags({ form: baseForm, formRelay, values, selectedConcepts });
    const event = {
      id: 'evt',
      pubkey: 'author',
      kind: 30142,
      created_at: 0,
      sig: '',
      content: '',
      tags: [['d', 'resource-id'], ...tags]
    };

    const ref = getFormReferenceFromResource(event);
    expect(ref).toEqual({ address: '30168:edupub:amb-basic', relay: 'wss://relay.example' });
  });

  it('getFormReferenceFromResource returns null for events without a form back-ref', () => {
    const event = {
      id: 'evt',
      pubkey: 'author',
      kind: 30142,
      created_at: 0,
      sig: '',
      content: '',
      tags: [
        ['d', 'resource-id'],
        ['name', 'No form']
      ]
    };
    expect(getFormReferenceFromResource(event)).toBeNull();
  });

  it('skips empty values (no tag emission for blank fields)', () => {
    const sparseValues = {
      name: 'Only name',
      description: '',
      about: [],
      kompetenz: [],
      klassenstufe: ''
    };
    const tags = buildAMBResourceTags({
      form: baseForm,
      formRelay,
      values: sparseValues,
      selectedConcepts: {}
    });
    expect(tags.some((t) => t[0] === 'about:id')).toBe(false);
    expect(tags.some((t) => t[0]?.startsWith('ext:30168:edupub:amb-basic:kompetenz'))).toBe(false);
    expect(tags.some((t) => t[0] === 'ext:30168:edupub:amb-basic:klassenstufe')).toBe(false);
    expect(tags).toContainEqual(['name', 'Only name']);
  });
});
