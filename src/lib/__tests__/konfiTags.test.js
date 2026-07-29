/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { ambToNostr } from 'amb-nostr-converter';
import { parseKonfiTags } from '$lib/helpers/educational/konfiTags.js';
import { formDataToAmbExt } from '$lib/helpers/educational/formDataToAmbExt.js';
import { BILDUNGSBEREICHE } from '$lib/helpers/educational/bildungsbereich.js';

/** @type {import('$lib/helpers/educational/bildungsbereich.js').SubStepConfig[]} */
const SUB_STEPS = [
  {
    key: '4a',
    titleKey: 'konfi_step4a_title',
    fields: [
      {
        kind: 'vocab',
        schemeKey: 'konfiZielgruppen',
        tagSlug: 'zielgruppen',
        labelKey: 'konfi_field_zielgruppen',
        multi: true,
        required: true
      }
    ]
  },
  {
    key: '4b',
    titleKey: 'konfi_step4b_title',
    fields: [
      {
        kind: 'vocab',
        schemeKey: 'konfiThemen',
        tagSlug: 'themen',
        labelKey: 'konfi_field_themen',
        multi: true
      },
      { kind: 'scalar', tagSlug: 'subtitle', labelKey: 'konfi_field_subtitle', input: 'text' },
      {
        kind: 'scalar',
        tagSlug: 'plainLanguage',
        labelKey: 'konfi_field_plain_language',
        input: 'checkbox'
      }
    ]
  }
];

describe('parseKonfiTags', () => {
  it('reconstructs Ids + Labels for vocab fields', () => {
    const tags = [
      ['ext:org.edufeed.ekw.konfi:zielgruppen:id', 'urn:ku3'],
      ['ext:org.edufeed.ekw.konfi:zielgruppen:prefLabel:de', 'KU3'],
      ['ext:org.edufeed.ekw.konfi:zielgruppen:type', 'Concept'],
      ['ext:org.edufeed.ekw.konfi:zielgruppen:id', 'urn:ku4'],
      ['ext:org.edufeed.ekw.konfi:zielgruppen:prefLabel:de', 'KU4'],
      ['ext:org.edufeed.ekw.konfi:zielgruppen:type', 'Concept']
    ];
    expect(parseKonfiTags(tags, SUB_STEPS)).toEqual({
      konfiZielgruppenIds: ['urn:ku3', 'urn:ku4'],
      konfiZielgruppenLabels: [
        { id: 'urn:ku3', label: 'KU3' },
        { id: 'urn:ku4', label: 'KU4' }
      ]
    });
  });

  it('falls back label = id when prefLabel:de missing', () => {
    const tags = [
      ['ext:org.edufeed.ekw.konfi:themen:id', 'urn:x'],
      ['ext:org.edufeed.ekw.konfi:themen:type', 'Concept']
    ];
    expect(parseKonfiTags(tags, SUB_STEPS)).toEqual({
      konfiThemenIds: ['urn:x'],
      konfiThemenLabels: [{ id: 'urn:x', label: 'urn:x' }]
    });
  });

  it('parses scalar string and boolean fields', () => {
    const tags = [
      ['ext:org.edufeed.ekw.konfi:subtitle', 'Konfi-Tag 2026'],
      ['ext:org.edufeed.ekw.konfi:plainLanguage', 'true']
    ];
    expect(parseKonfiTags(tags, SUB_STEPS)).toEqual({
      subtitle: 'Konfi-Tag 2026',
      plainLanguage: true
    });
  });

  it('returns {} for events with no konfi tags', () => {
    expect(
      parseKonfiTags(
        [
          ['p', 'abc'],
          ['title', 'x']
        ],
        SUB_STEPS
      )
    ).toEqual({});
  });
});

describe('parseKonfiTags — allowCustom', () => {
  // ambToNostr serializes a facet's mixed Concept[]/string[] items in
  // emission order: each Concept as an `:id`/`:prefLabel:*`/`:type` run,
  // each plain string as a BARE `ext:<ns>:<facet>` tag — there is no
  // `:custom` sub-key on the wire (see formDataToAmbExt.buildKonfiFacets +
  // ambToNostr's ext-emission loop). `parseKonfiTags` mirrors that shape.
  it('reads the bare facet tag into <schemeKey>Custom for allowCustom fields', () => {
    const subSteps =
      /** @type {import('$lib/helpers/educational/konfiTags.js').SubStepConfig[]} */ ([
        {
          key: 'x',
          titleKey: 'x',
          fields: [
            {
              kind: 'vocab',
              schemeKey: 'konfiZeitstruktur',
              tagSlug: 'zeitstruktur',
              labelKey: 'konfi_field_zeitstruktur',
              multi: true,
              allowCustom: true
            }
          ]
        }
      ]);
    const tags = [
      ['ext:org.edufeed.ekw.konfi:zeitstruktur:id', 'urn:zt:wochenende'],
      ['ext:org.edufeed.ekw.konfi:zeitstruktur:prefLabel:de', 'Wochenende'],
      ['ext:org.edufeed.ekw.konfi:zeitstruktur:type', 'Concept'],
      ['ext:org.edufeed.ekw.konfi:zeitstruktur', '3-Tage-Freizeit']
    ];
    const out = parseKonfiTags(tags, subSteps);
    expect(out.konfiZeitstrukturIds).toEqual(['urn:zt:wochenende']);
    expect(out.konfiZeitstrukturCustom).toBe('3-Tage-Freizeit');
  });

  it('reads custom-only (no vocab picks) when only the bare facet tag is present', () => {
    const subSteps =
      /** @type {import('$lib/helpers/educational/konfiTags.js').SubStepConfig[]} */ ([
        {
          key: 'x',
          titleKey: 'x',
          fields: [
            {
              kind: 'vocab',
              schemeKey: 'konfiZeitstruktur',
              tagSlug: 'zeitstruktur',
              labelKey: 'konfi_field_zeitstruktur',
              multi: true,
              allowCustom: true
            }
          ]
        }
      ]);
    const tags = [['ext:org.edufeed.ekw.konfi:zeitstruktur', 'monatlich']];
    const out = parseKonfiTags(tags, subSteps);
    expect(out.konfiZeitstrukturCustom).toBe('monatlich');
    expect(out.konfiZeitstrukturIds).toBeUndefined();
  });

  it('does not read a bare facet tag as custom for vocab fields without allowCustom', () => {
    const subSteps =
      /** @type {import('$lib/helpers/educational/konfiTags.js').SubStepConfig[]} */ ([
        {
          key: 'x',
          titleKey: 'x',
          fields: [
            {
              kind: 'vocab',
              schemeKey: 'konfiLernformat',
              tagSlug: 'lernformat',
              labelKey: 'konfi_field_lernformat',
              multi: true
            }
          ]
        }
      ]);
    const tags = [['ext:org.edufeed.ekw.konfi:lernformat', 'should be ignored']];
    const out = parseKonfiTags(tags, subSteps);
    expect(out.konfiLernformatCustom).toBeUndefined();
  });
});

describe('konfi tag round-trip (production emit path: formDataToAmbExt → ambToNostr → parseKonfiTags)', () => {
  // formDataToAmbExt is hardwired to walk the REAL BILDUNGSBEREICHE.konfi
  // config (not this file's fictional SUB_STEPS fixture above, which has no
  // production meaning to the emit side) — so parsing back must use the same
  // real config too.
  const REAL_SUB_STEPS = BILDUNGSBEREICHE.konfi.step4SubSteps ?? [];

  it('emit → parse is stable for vocab + scalar mix', () => {
    const formData = {
      konfiThemenIds: ['urn:t1', 'urn:t2'],
      konfiThemenLabels: [
        { id: 'urn:t1', label: 'Thema 1' },
        { id: 'urn:t2', label: 'Thema 2' }
      ],
      requiredMaterialsNote: 'Bibel, Wasser, Tuch',
      plainLanguage: true
    };
    const ext = formDataToAmbExt(formData);
    const amb = {
      id: 'x',
      type: ['LearningResource'],
      name: 'n',
      description: 'd',
      inLanguage: ['de'],
      license: { id: 'https://creativecommons.org/licenses/by/4.0/' },
      ext
    };
    const result = ambToNostr(/** @type {any} */ (amb), { pubkey: 'pk', timestamp: 0 });
    expect(result.success).toBe(true);
    const tags = /** @type {any} */ (result.data).tags;

    expect(parseKonfiTags(tags, REAL_SUB_STEPS)).toEqual({
      konfiThemenIds: ['urn:t1', 'urn:t2'],
      konfiThemenLabels: [
        { id: 'urn:t1', label: 'Thema 1' },
        { id: 'urn:t2', label: 'Thema 2' }
      ],
      requiredMaterialsNote: 'Bibel, Wasser, Tuch',
      plainLanguage: true
    });
  });
});
