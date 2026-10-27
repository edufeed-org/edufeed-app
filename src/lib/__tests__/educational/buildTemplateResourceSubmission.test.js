/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildTemplateResourceSubmission } from '$lib/helpers/educational/buildTemplateResourceSubmission.js';
import { identifierFromAddress } from 'nostr-vocab-core/identifiers';

const signerPubkey = 'a'.repeat(64);

const form = {
  pubkey: 'edupub',
  dTag: 'amb-basic',
  fields: [
    { id: 'title', type: 'text', output: 'amb:name' },
    { id: 'description', type: 'textarea', output: 'amb:description' },
    {
      id: 'about',
      type: 'select',
      output: 'amb:about',
      vocab: { address: '39737:edupub:schulfaecher', relay: 'wss://vocab.example' }
    },
    { id: 'refs', type: 'external-urls', output: 'amb:refs' }
  ]
};

/** @param {string[][]} tags @param {string} key */
const findTag = (tags, key) => tags.find((t) => t[0] === key);

describe('buildTemplateResourceSubmission (create mode)', () => {
  const rawValues = {
    title: 'Pythagoras-Video',
    description: 'Ein Video zum Satz des Pythagoras.',
    about: ['https://w3id.org/kim/schulfaecher/s1017'],
    refs: ['https://example.org/a', 'https://example.org/b']
  };
  const selectedConcepts = {
    about: [{ id: 'https://w3id.org/kim/schulfaecher/s1017', labels: { de: 'Mathematik' } }]
  };

  it('produces the NIP-AMB core tag set via the shared converter', () => {
    const { tags } = buildTemplateResourceSubmission({
      form,
      formRelay: 'wss://relay.example',
      rawValues,
      selectedConcepts,
      signerPubkey,
      isEditMode: false
    });
    expect(tags).toContainEqual(['name', 'Pythagoras-Video']);
    expect(tags).toContainEqual(['about:id', 'https://w3id.org/kim/schulfaecher/s1017']);
    expect(tags).toContainEqual(['about:prefLabel:de', 'Mathematik']);
    expect(tags).toContainEqual(['about:type', 'Concept']);
    expect(tags.some((t) => t[0] === 'a' && t[3] === 'about')).toBe(false); // no a-tag for concepts
  });

  it('sets content from the AMB description', () => {
    const { content } = buildTemplateResourceSubmission({
      form,
      formRelay: 'wss://relay.example',
      rawValues,
      selectedConcepts,
      signerPubkey,
      isEditMode: false
    });
    expect(content).toBe('Ein Video zum Satz des Pythagoras.');
  });

  it('appends external URLs as r-tags (extras, not part of the AMB object)', () => {
    const { tags } = buildTemplateResourceSubmission({
      form,
      formRelay: 'wss://relay.example',
      rawValues,
      selectedConcepts,
      signerPubkey,
      isEditMode: false
    });
    expect(tags).toContainEqual(['r', 'https://example.org/a']);
    expect(tags).toContainEqual(['r', 'https://example.org/b']);
  });

  it('appends the informative form back-reference a-tag', () => {
    const { tags } = buildTemplateResourceSubmission({
      form,
      formRelay: 'wss://relay.example',
      rawValues,
      selectedConcepts,
      signerPubkey,
      isEditMode: false
    });
    expect(tags).toContainEqual(['a', '30168:edupub:amb-basic', 'wss://relay.example', 'form']);
  });

  it('puts the d tag first', () => {
    const { tags } = buildTemplateResourceSubmission({
      form,
      formRelay: 'wss://relay.example',
      rawValues,
      selectedConcepts,
      signerPubkey,
      isEditMode: false
    });
    expect(tags[0][0]).toBe('d');
  });

  it('honors an amb:id-mapped url field as the d tag when no resource exists yet', () => {
    const idForm = {
      pubkey: 'edupub',
      dTag: 'amb-basic',
      fields: [
        { id: 'title', type: 'text', output: 'amb:name' },
        { id: 'url', type: 'url', output: 'amb:id' }
      ]
    };
    const { dTag, tags } = buildTemplateResourceSubmission({
      form: idForm,
      formRelay: '',
      rawValues: { title: 'X', url: 'https://x.example/1' },
      selectedConcepts: {},
      signerPubkey,
      isEditMode: false
    });
    expect(dTag).toBe('https://x.example/1');
    expect(findTag(tags, 'd')?.[1]).toBe('https://x.example/1');
  });

  it('falls back to a generated id when the create-mode form emits no d tag', () => {
    const { dTag } = buildTemplateResourceSubmission({
      form,
      formRelay: '',
      rawValues,
      selectedConcepts,
      signerPubkey,
      isEditMode: false
    });
    expect(typeof dTag).toBe('string');
    expect(dTag.length).toBeGreaterThan(0);
  });

  it('falls back to the raw description value when the converter content is empty', () => {
    const noDescForm = {
      pubkey: 'edupub',
      dTag: 'amb-basic',
      fields: [{ id: 'title', type: 'text', output: 'amb:name' }]
    };
    const { content } = buildTemplateResourceSubmission({
      form: noDescForm,
      formRelay: '',
      rawValues: { title: 'X', description: 'Fallback description text' },
      selectedConcepts: {},
      signerPubkey,
      isEditMode: false
    });
    expect(content).toBe('Fallback description text');
  });
});

describe('buildTemplateResourceSubmission (companion concept a tags, NIP-VOCAB)', () => {
  const PK = 'd2689e2f41dabfba953da26655a94ce2aa4e029c383ee921c6a4deafab99a612';
  const conceptForm = {
    pubkey: 'edupub',
    dTag: 'konfi',
    fields: [
      { id: 'title', type: 'text', output: 'amb:name' },
      {
        id: 'about',
        type: 'select',
        output: 'amb:about',
        vocab: { address: `39737:${PK}:schulfaecher`, relay: 'wss://vocab.example' }
      },
      {
        id: 'level',
        type: 'select',
        output: 'amb:educationalLevel',
        vocab: { address: `39737:${PK}:klassenstufen`, relay: 'wss://vocab.example' }
      },
      {
        id: 'zeitstruktur',
        type: 'select',
        output: 'ext',
        vocab: { address: `39737:${PK}:zeit`, relay: 'wss://vocab.example' }
      }
    ]
  };
  const selectedConcepts = {
    about: [
      {
        id: 'http://w3id.org/kim/schulfaecher/s1017',
        nostrCoord: `39738:${PK}:s1017`,
        relay: 'wss://vocab.example',
        labels: { de: 'Mathematik' }
      }
    ],
    level: [
      {
        id: identifierFromAddress(`39738:${PK}:5-6`),
        nostrCoord: `39738:${PK}:5-6`,
        relay: 'wss://vocab.example',
        labels: { de: 'Klasse 5/6' }
      },
      {
        id: `nostr:39738:${PK}:5-6`,
        nostrCoord: `39738:${PK}:5-6`,
        relay: 'wss://vocab.example',
        labels: { de: 'Klasse 5/6' }
      } // legacy duplicate
    ],
    zeitstruktur: [
      {
        id: identifierFromAddress(`39738:${PK}:dz`),
        nostrCoord: `39738:${PK}:dz`,
        relay: 'wss://vocab.example',
        labels: { de: 'Doppelstunde' }
      }
    ]
  };
  const build = () =>
    buildTemplateResourceSubmission({
      form: conceptForm,
      formRelay: 'wss://relay.example',
      rawValues: { title: 'X' },
      selectedConcepts,
      signerPubkey,
      isEditMode: false
    });

  it('appends one companion a tag per concept with the flattened prefix as marker and the vocab relay as hint', () => {
    const { tags } = build();
    const aTags = tags.filter((t) => t[0] === 'a');
    expect(aTags).toContainEqual(['a', `39738:${PK}:s1017`, 'wss://vocab.example', 'about']);
    expect(aTags).toContainEqual([
      'a',
      `39738:${PK}:5-6`,
      'wss://vocab.example',
      'educationalLevel'
    ]);
    expect(aTags).toContainEqual([
      'a',
      `39738:${PK}:dz`,
      'wss://vocab.example',
      'ext:konfi:zeitstruktur'
    ]);
    expect(aTags.filter((t) => t[1] === `39738:${PK}:5-6`)).toHaveLength(1); // deduplicated
  });
  it('writes canonical ids only, and keeps the form back-reference as the last tag', () => {
    const { tags } = build();
    expect(tags.filter((t) => t[0] === 'educationalLevel:id').map((t) => t[1])).toEqual([
      identifierFromAddress(`39738:${PK}:5-6`)
    ]);
    expect(tags.some((t) => typeof t[1] === 'string' && /^nostr:3973\d:/.test(t[1]))).toBe(false);
    expect(tags[tags.length - 1]).toEqual([
      'a',
      '30168:edupub:konfi',
      'wss://relay.example',
      'form'
    ]);
  });
});

describe('buildTemplateResourceSubmission (edit mode)', () => {
  it('preserves the resource existing d tag, never clobbering it with an amb:id-emitted or generated one', () => {
    const idForm = {
      pubkey: 'edupub',
      dTag: 'amb-basic',
      fields: [
        { id: 'title', type: 'text', output: 'amb:name' },
        { id: 'url', type: 'url', output: 'amb:id' }
      ]
    };
    const { dTag, tags } = buildTemplateResourceSubmission({
      form: idForm,
      formRelay: '',
      rawValues: { title: 'X', url: 'https://x.example/should-not-win' },
      selectedConcepts: {},
      signerPubkey,
      isEditMode: true,
      existingDTag: 'existing-resource-id'
    });
    expect(dTag).toBe('existing-resource-id');
    expect(findTag(tags, 'd')?.[1]).toBe('existing-resource-id');
  });
});
