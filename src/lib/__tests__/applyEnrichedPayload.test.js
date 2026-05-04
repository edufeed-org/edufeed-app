/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { applyEnrichedPayload } from '$lib/helpers/educational/applyEnrichedPayload.js';

/**
 * Build a fresh formData stand-in matching the wizard's shape so each test
 * starts from a clean slate.
 */
function makeFormData(overrides = {}) {
  return {
    bildungsbereich: '',
    urlInput: '',
    name: '',
    description: '',
    inLanguage: 'de',
    image: '',
    identifier: '',
    learningResourceType: [],
    educationalLevels: [],
    keywords: [],
    creators: [],
    license: 'https://creativecommons.org/licenses/by/4.0/',
    isAccessibleForFree: true,
    // EKW-only paired shape: ID arrays + label arrays
    ekwFachrichtung: [],
    gradeLevels: [],
    gradeLevelLabels: [],
    schoolTypes: [],
    schoolTypeLabels: [],
    didacticConcepts: [],
    didacticConceptLabels: [],
    methods: [],
    methodLabels: [],
    methodOther: '',
    bibleReferences: [''],
    ...overrides
  };
}

describe('applyEnrichedPayload', () => {
  it('returns formData unchanged when result is null/undefined', () => {
    const before = makeFormData({ name: 'Existing' });
    const after = applyEnrichedPayload(before, null);
    expect(after.name).toBe('Existing');
  });

  it('fills empty scalar fields from the payload', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: {
        name: 'Photosynthesis',
        description: 'Lesson about photosynthesis',
        image: 'https://example.org/img.jpg',
        inLanguage: 'en'
      },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.name).toBe('Photosynthesis');
    expect(after.description).toBe('Lesson about photosynthesis');
    expect(after.image).toBe('https://example.org/img.jpg');
    expect(after.inLanguage).toBe('en');
  });

  it('does NOT overwrite scalar fields that already have user-entered values', () => {
    const formData = makeFormData({ name: 'My Title', description: 'My desc' });
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { name: 'LLM Title', description: 'LLM desc' },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.name).toBe('My Title');
    expect(after.description).toBe('My desc');
  });

  it('maps SKOS concept arrays from {id, prefLabel} → {id, label}', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: {
        learningResourceType: [{ id: 'https://w3id.org/kim/hcrt/text', prefLabel: 'Text' }],
        educationalLevels: [
          { id: 'https://w3id.org/kim/educationalLevel/level_A', prefLabel: 'Sek I' }
        ]
      },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.learningResourceType).toEqual([
      { id: 'https://w3id.org/kim/hcrt/text', label: 'Text' }
    ]);
    expect(after.educationalLevels).toEqual([
      { id: 'https://w3id.org/kim/educationalLevel/level_A', label: 'Sek I' }
    ]);
  });

  it('does NOT overwrite SKOS arrays that already have entries', () => {
    const formData = makeFormData({
      learningResourceType: [{ id: 'existing', label: 'Existing' }]
    });
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: {
        learningResourceType: [{ id: 'new', prefLabel: 'New' }]
      },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.learningResourceType).toEqual([{ id: 'existing', label: 'Existing' }]);
  });

  it('fills keywords array when empty', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { keywords: ['Biologie', 'Pflanzen'] },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.keywords).toEqual(['Biologie', 'Pflanzen']);
  });

  it('fills creators array (passes through {name, type, id}) when empty', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: {
        creators: [{ name: 'Jane Doe', type: 'Person' }]
      },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.creators).toEqual([{ name: 'Jane Doe', type: 'Person' }]);
  });

  it('replaces the auto-added active-user creator with LLM-extracted creators', () => {
    // The wizard auto-adds the active user as a single creator on login. When
    // the resource is sourced from a 3rd-party URL, the LLM-extracted authors
    // should replace that auto-add — the user is sharing, not authoring.
    const activeUserPubkey = 'abcdef0123';
    const formData = makeFormData({
      creators: [{ name: 'Me', type: 'Person', pubkey: activeUserPubkey }]
    });
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: {
        creators: [{ name: 'Jane Doe', type: 'Person' }]
      },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result, { activeUserPubkey });
    expect(after.creators).toEqual([{ name: 'Jane Doe', type: 'Person' }]);
  });

  it('does NOT replace creators when the existing entries are not just the auto-added user', () => {
    const activeUserPubkey = 'abcdef0123';
    const formData = makeFormData({
      creators: [
        { name: 'Me', type: 'Person', pubkey: activeUserPubkey },
        { name: 'Co-author', type: 'Person' }
      ]
    });
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { creators: [{ name: 'Jane Doe', type: 'Person' }] },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result, { activeUserPubkey });
    expect(after.creators).toEqual([
      { name: 'Me', type: 'Person', pubkey: activeUserPubkey },
      { name: 'Co-author', type: 'Person' }
    ]);
  });

  it('applies license string when current value still equals the form default', () => {
    const formData = makeFormData(); // default = CC-BY 4.0
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { license: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.license).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
  });

  it('does NOT overwrite license the user explicitly set to a different value', () => {
    const formData = makeFormData({
      license: 'https://creativecommons.org/publicdomain/zero/1.0/'
    });
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { license: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.license).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
  });

  it('returns a NEW object (does not mutate input)', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { name: 'LLM' },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after).not.toBe(formData);
    expect(formData.name).toBe('');
  });

  it('applies ekwFachrichtung as {id,label}[] when empty', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: {
        ekwFachrichtung: [{ id: '39738:abc:evangelisch', prefLabel: 'Evangelisch' }]
      },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.ekwFachrichtung).toEqual([{ id: '39738:abc:evangelisch', label: 'Evangelisch' }]);
  });

  // Wizard pairs IDs (plural) with labels (singular + Labels): the IDs key
  // ends with 's' (gradeLevels), the labels key drops the trailing 's' before
  // adding "Labels" (gradeLevelLabels). This pairing is what the EKW step-4
  // pickers read; assert against the wizard-correct names.
  it.each([
    ['gradeLevels', 'gradeLevelLabels'],
    ['schoolTypes', 'schoolTypeLabels'],
    ['didacticConcepts', 'didacticConceptLabels'],
    ['methods', 'methodLabels']
  ])('fills paired %s + %s (split IDs and full records) when empty', (key, labelKey) => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: {
        [key]: [
          { id: '39738:abc:1', prefLabel: 'One' },
          { id: '39738:abc:2', prefLabel: 'Two' }
        ]
      },
      evidence: {},
      baseline: {}
    };
    const after = /** @type {Record<string, any>} */ (applyEnrichedPayload(formData, result));
    expect(after[key]).toEqual(['39738:abc:1', '39738:abc:2']);
    expect(after[labelKey]).toEqual([
      { id: '39738:abc:1', label: 'One' },
      { id: '39738:abc:2', label: 'Two' }
    ]);
  });

  it('does NOT overwrite EKW paired arrays that already have entries', () => {
    const formData = makeFormData({
      gradeLevels: ['existing'],
      gradeLevelLabels: [{ id: 'existing', label: 'Existing' }]
    });
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: {
        gradeLevels: [{ id: 'new', prefLabel: 'New' }]
      },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.gradeLevels).toEqual(['existing']);
    expect(after.gradeLevelLabels).toEqual([{ id: 'existing', label: 'Existing' }]);
  });

  it('fills methodOther string when empty', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { methodOther: 'Stationenlernen' },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.methodOther).toBe('Stationenlernen');
  });

  it('fills bibleReferences when current is the default [""]', () => {
    const formData = makeFormData(); // default is ['']
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { bibleReferences: ['Mt 5,1-12', 'Lk 6,20-26'] },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.bibleReferences).toEqual(['Mt 5,1-12', 'Lk 6,20-26']);
  });

  it('does NOT overwrite bibleReferences the user already started filling', () => {
    const formData = makeFormData({ bibleReferences: ['Mt 1,1', ''] });
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { bibleReferences: ['Mt 5,1-12'] },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.bibleReferences).toEqual(['Mt 1,1', '']);
  });

  it('returns formData unchanged when source is amb-jsonld (already handled by AMB path)', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('amb-jsonld'),
      payload: { name: 'AMB Title' },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.name).toBe('');
  });
});

describe('applyEnrichedPayload — provenance tracking', () => {
  // Provenance is the bridge between the helper and the badge UI: each field
  // that the helper actually filled gets recorded with its source and (when
  // available) the LLM evidence quote. The wizard reads this map to render
  // "Smart fill ✨" badges; clearing a field deletes its entry.

  it('records llm-enriched + evidence for each field it actually fills', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: {
        name: 'X',
        description: 'Y',
        learningResourceType: [{ id: 'hcrt:text', prefLabel: 'Text' }],
        gradeLevels: [{ id: 'gl:1', prefLabel: 'Jg 1' }]
      },
      evidence: {
        name: 'name-quote',
        description: 'desc-quote',
        learningResourceType: 'lrt-quote',
        gradeLevels: 'gl-quote'
      },
      baseline: {}
    };
    const { formData: after, provenance } = applyEnrichedPayload.withProvenance(formData, result);
    expect(after.name).toBe('X');
    expect(provenance.name).toEqual({ source: 'llm-enriched', evidence: 'name-quote' });
    expect(provenance.description).toEqual({
      source: 'llm-enriched',
      evidence: 'desc-quote'
    });
    expect(provenance.learningResourceType).toEqual({
      source: 'llm-enriched',
      evidence: 'lrt-quote'
    });
    // Paired field: provenance is keyed on the user-facing field, not the
    // <key>Labels mirror, so the badge component only attaches in one place.
    expect(provenance.gradeLevels).toEqual({
      source: 'llm-enriched',
      evidence: 'gl-quote'
    });
    expect(provenance.gradeLevelsLabels).toBeUndefined();
  });

  it('does NOT record provenance for fields that were skipped (already filled)', () => {
    const formData = makeFormData({ name: 'User typed this' });
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { name: 'LLM tried this', description: 'LLM desc' },
      evidence: { name: 'n', description: 'd' },
      baseline: {}
    };
    const { provenance } = applyEnrichedPayload.withProvenance(formData, result);
    expect(provenance.name).toBeUndefined();
    expect(provenance.description).toEqual({ source: 'llm-enriched', evidence: 'd' });
  });

  it('omits evidence key in provenance when the LLM did not return one', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { name: 'X' },
      evidence: {}, // no quote for `name`
      baseline: {}
    };
    const { provenance } = applyEnrichedPayload.withProvenance(formData, result);
    expect(provenance.name).toEqual({ source: 'llm-enriched' });
  });

  it('returns empty provenance for amb-jsonld results (no badges on AMB path)', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('amb-jsonld'),
      payload: { name: 'AMB' },
      evidence: {},
      baseline: {}
    };
    const { provenance } = applyEnrichedPayload.withProvenance(formData, result);
    expect(provenance).toEqual({});
  });
});
