/** @vitest-environment node */
/**
 * EKKW metadata form — the two serializer gaps from the research thread
 * (Buzz #edufeed-app, 2026-08-03):
 *
 * Gap 3: Herausgeber ≠ Autor. A creator-typed field routed to
 * `amb:contributor` must land its people (incl. ORCID ids) in
 * `amb.contributor`, not collide with the authors' `amb.creator`.
 *
 * Gap 2: "Erschienen in" as free text. An amb-relation entry that carries a
 * `name` instead of a nostr coordinate must emit an isPartOf item
 * `{name, type:'CreativeWork'}` — the container of a scholarly article is
 * usually NOT an event on our relays.
 *
 * The edit direction is asserted too: while LOCKED_FIELD_OUTPUTS pins
 * creator -> amb:creator, fieldToState would silently revert a contributor
 * field to creator the first time an author reopens the form.
 */
import { describe, it, expect } from 'vitest';
import { formValuesToAmbJson } from '$lib/helpers/educational/formValuesToAmbJson.js';
import { builderStateToTags, fieldToState } from '$lib/helpers/forms/builder-state.js';
import { parseFormTemplate } from '$lib/helpers/forms/format.js';

const AUTHOR = {
  name: 'Ada Autor',
  type: 'Person',
  orcid: 'https://orcid.org/0000-0002-1825-0097'
};
const EDITOR = {
  name: 'Erik Editor',
  type: 'Person',
  orcid: 'https://orcid.org/0000-0001-5109-3700'
};

/** @param {any[]} fields */
function form(fields) {
  return { pubkey: '', dTag: 'ekkw-test', name: 'EKKW', fields };
}

describe('gap 3: creator field routed to amb:contributor', () => {
  it('lands people with ORCID ids in amb.contributor, not amb.creator', () => {
    const { amb } = formValuesToAmbJson(
      form([{ id: 'editors', type: 'creator', label: 'Herausgeber', output: 'amb:contributor' }]),
      { editors: [EDITOR] },
      {}
    );
    expect(amb.contributor).toEqual([
      { name: 'Erik Editor', type: 'Person', id: 'https://orcid.org/0000-0001-5109-3700' }
    ]);
    expect(amb.creator).toBeUndefined();
  });

  it('default output still lands in amb.creator (unchanged behaviour)', () => {
    const { amb } = formValuesToAmbJson(
      form([{ id: 'authors', type: 'creator', label: 'Autoren' }]),
      { authors: [AUTHOR] },
      {}
    );
    expect(amb.creator?.[0]?.id).toBe('https://orcid.org/0000-0002-1825-0097');
    expect(amb.contributor).toBeUndefined();
  });

  it('two creator fields — authors and editors — do not collide', () => {
    const { amb } = formValuesToAmbJson(
      form([
        { id: 'authors', type: 'creator', label: 'Autoren', output: 'amb:creator' },
        { id: 'editors', type: 'creator', label: 'Herausgeber', output: 'amb:contributor' }
      ]),
      { authors: [AUTHOR], editors: [EDITOR] },
      {}
    );
    expect(amb.creator?.map((/** @type {any} */ c) => c.name)).toEqual(['Ada Autor']);
    expect(amb.contributor?.map((/** @type {any} */ c) => c.name)).toEqual(['Erik Editor']);
  });

  it('edit cycle: a contributor output survives parse -> fieldToState -> tags', () => {
    const state = {
      id: 'editors',
      type: 'creator',
      label: 'Herausgeber',
      defaultValue: '',
      required: false,
      placeholder: '',
      min: undefined,
      max: undefined,
      selectOptions: [],
      multiple: false,
      vocab: undefined,
      output: 'amb:contributor'
    };
    const original = builderStateToTags([state], { dTag: 'ekkw-test', name: 'EKKW' });
    const parsed = parseFormTemplate(
      /** @type {any} */ ({ kind: 30168, pubkey: '', tags: original, content: '', created_at: 0 })
    );
    const reencoded = builderStateToTags(parsed.fields.map(fieldToState), {
      dTag: 'ekkw-test',
      name: 'EKKW'
    });
    expect(reencoded).toEqual(original);
    const outTag = reencoded.find((t) => t[0] === 'field-output');
    expect(outTag?.[2]).toBe('amb:contributor');
  });
});

describe('gap 2: name-only isPartOf entries ("Erschienen in")', () => {
  it('a name-only entry emits {name, type: CreativeWork}', () => {
    const { amb } = formValuesToAmbJson(
      form([
        { id: 'container', type: 'amb-relation', label: 'Erschienen in', output: 'amb:isPartOf' }
      ]),
      { container: [{ name: 'Zeitschrift für Pädagogik und Theologie' }] },
      {}
    );
    expect(amb.isPartOf).toEqual([
      { name: 'Zeitschrift für Pädagogik und Theologie', type: 'CreativeWork' }
    ]);
  });

  it('coordinate and name entries coexist in one field', () => {
    const { amb } = formValuesToAmbJson(
      form([
        { id: 'container', type: 'amb-relation', label: 'Erschienen in', output: 'amb:isPartOf' }
      ]),
      {
        container: [
          {
            coordinate:
              '30142:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:some-d'
          },
          { name: 'Sammelband Religionspädagogik' }
        ]
      },
      {}
    );
    expect(amb.isPartOf).toHaveLength(2);
    expect(amb.isPartOf[0].id).toMatch(/^nostr:naddr1/);
    expect(amb.isPartOf[1]).toEqual({
      name: 'Sammelband Religionspädagogik',
      type: 'CreativeWork'
    });
  });

  it('control: entries with neither coordinate nor name are dropped', () => {
    const { amb } = formValuesToAmbJson(
      form([
        { id: 'container', type: 'amb-relation', label: 'Erschienen in', output: 'amb:isPartOf' }
      ]),
      { container: [{}, { name: '' }] },
      {}
    );
    expect(amb.isPartOf).toEqual([]);
  });
});

describe('reverse direction: ambJsonToFormValues (resource-edit path)', () => {
  it('a contributor field reads amb.contributor on edit, not the authors', async () => {
    const { ambJsonToFormValues } = await import('$lib/helpers/educational/ambJsonToFormValues.js');
    const { values } = ambJsonToFormValues(
      {
        creator: [
          { name: 'Ada Autor', type: 'Person', id: 'https://orcid.org/0000-0002-1825-0097' }
        ],
        contributor: [{ name: 'Erik Editor', type: 'Person' }]
      },
      form([
        { id: 'authors', type: 'creator', label: 'Autoren', output: 'amb:creator' },
        { id: 'editors', type: 'creator', label: 'Herausgeber', output: 'amb:contributor' }
      ])
    );
    expect(values.authors.map((/** @type {any} */ c) => c.name)).toEqual(['Ada Autor']);
    expect(values.editors.map((/** @type {any} */ c) => c.name)).toEqual(['Erik Editor']);
  });

  it('name-only isPartOf entries come back as {name} values on edit', async () => {
    const { ambJsonToFormValues } = await import('$lib/helpers/educational/ambJsonToFormValues.js');
    const { values } = ambJsonToFormValues(
      { isPartOf: [{ name: 'Zeitschrift für Pädagogik und Theologie', type: 'CreativeWork' }] },
      form([
        { id: 'container', type: 'amb-relation', label: 'Erschienen in', output: 'amb:isPartOf' }
      ])
    );
    expect(values.container).toEqual([{ name: 'Zeitschrift für Pädagogik und Theologie' }]);
  });
});
