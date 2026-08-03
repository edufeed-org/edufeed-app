/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { nip19 } from 'nostr-tools';

import { buildFormTemplate } from '../publish-forms-build.mjs';
import { parseFormTemplate } from '../../../src/lib/helpers/forms/format.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { forms } = JSON.parse(
  readFileSync(resolve(__dirname, '../../data/edufeed-forms.json'), 'utf8')
);

const PUBKEY = 'ab'.repeat(32);
const RELAY = 'wss://relay.example/';

/** Synthetic scheme naddr so vocabRef resolution works without real env. */
function fakeNaddr(identifier) {
  return nip19.naddrEncode({ kind: 39737, pubkey: PUBKEY, identifier, relays: [RELAY] });
}

describe('publish-edufeed-forms — buildFormTemplate (NIP-101 regression)', () => {
  describe('edufeed-membership (no vocab refs)', () => {
    const membership = forms.find((f) => f.d === 'edufeed-membership');
    const template = buildFormTemplate(membership);

    it('emits a kind-30168 template with a settings tag', () => {
      expect(template.kind).toBe(30168);
      const settingsTag = template.tags.find((t) => t[0] === 'settings');
      expect(settingsTag).toBeDefined();
      expect(JSON.parse(settingsTag[1]).description).toBe(membership.description);
    });

    it('encodes the textarea field on NIP-101 positions with renderElement + required', () => {
      const motivation = template.tags.find((t) => t[0] === 'field' && t[1] === 'motivation');
      expect(motivation).toBeDefined();
      // [field, id, inputType, label, optionsJSON, settingsJSON]
      expect(motivation[2]).toBe('text');
      expect(motivation[3]).toBe(membership.fields.find((f) => f.id === 'motivation').label);
      expect(JSON.parse(motivation[4])).toEqual([]);
      const settings = JSON.parse(motivation[5]);
      expect(settings.renderElement).toBe('textarea');
      expect(settings.required).toBe(true);
    });

    it('preserves field constraints in the settings JSON', () => {
      const handle = template.tags.find((t) => t[0] === 'field' && t[1] === 'wished_handle');
      const settings = JSON.parse(handle[5]);
      expect(settings).toMatchObject({
        renderElement: 'text',
        required: true,
        min: 2,
        max: 30,
        pattern: '^[a-z0-9._-]+$'
      });
    });

    it('round-trips through the app parser', () => {
      const parsed = parseFormTemplate({
        kind: 30168,
        pubkey: PUBKEY,
        tags: template.tags,
        content: '',
        created_at: 1
      });
      expect(parsed.dTag).toBe('edufeed-membership');
      expect(parsed.name).toBe(membership.name);
      expect(parsed.description).toBe(membership.description);
      expect(parsed.fields).toHaveLength(membership.fields.length);
      const motivation = parsed.fields.find((f) => f.id === 'motivation');
      expect(motivation.type).toBe('textarea');
      expect(motivation.options?.required).toBe(true);
    });
  });

  describe('amb-basic (vocab-bound fields)', () => {
    beforeEach(() => {
      vi.stubEnv('SCHEME_NADDR_SCHULFAECHER', fakeNaddr('schulfaecher'));
      vi.stubEnv('SCHEME_NADDR_HCRT', fakeNaddr('hcrt'));
    });
    afterEach(() => vi.unstubAllEnvs());

    it('emits field-vocab and field-output tags for vocab-bound fields', () => {
      const template = buildFormTemplate(forms.find((f) => f.d === 'amb-basic'));

      const about = template.tags.find((t) => t[0] === 'field' && t[1] === 'about');
      expect(about[2]).toBe('text'); // vocab select: inputType text + renderElement
      expect(JSON.parse(about[5])).toMatchObject({
        renderElement: 'select',
        required: true,
        multiple: true
      });

      const vocab = template.tags.find((t) => t[0] === 'field-vocab' && t[1] === 'about');
      expect(vocab).toEqual(['field-vocab', 'about', 'a', `39737:${PUBKEY}:schulfaecher`, RELAY]);
      expect(template.tags.find((t) => t[0] === 'field-output' && t[1] === 'about')).toEqual([
        'field-output',
        'about',
        'amb:about'
      ]);
    });
  });

  describe('ekkw-hochschule (sections, inline options, field descriptions)', () => {
    beforeEach(() => {
      vi.stubEnv('SCHEME_NADDR_FACHSYSTEMATIK_THEOLOGIE', fakeNaddr('fachsystematik-theologie'));
    });
    afterEach(() => vi.unstubAllEnvs());

    const buildEkkw = () => buildFormTemplate(forms.find((f) => f.d === 'ekkw-hochschule'));

    it('encodes inline selectOptions as an option field with the option list JSON', () => {
      const template = buildEkkw();
      const pubtype = template.tags.find((t) => t[0] === 'field' && t[1] === 'pubtype');
      expect(pubtype[2]).toBe('option');
      expect(JSON.parse(pubtype[4])).toEqual([
        ['zeitschrift', 'Zeitschrift'],
        ['sammelband', 'Sammelband']
      ]);
      expect(JSON.parse(pubtype[5])).toMatchObject({ renderElement: 'radio', required: true });
    });

    it('carries the per-field description in the field settings bag', () => {
      const template = buildEkkw();
      const doi = template.tags.find((t) => t[0] === 'field' && t[1] === 'doi');
      expect(JSON.parse(doi[5]).description).toMatch(/Digital Object Identifier/);
    });

    it('carries the sections (with questionIds) in the template settings', () => {
      const template = buildEkkw();
      const settings = JSON.parse(template.tags.find((t) => t[0] === 'settings')[1]);
      expect(settings.sections.map((s) => s.id)).toEqual([
        'publikationstyp',
        'quelle',
        'inhalt',
        'personen'
      ]);
      expect(settings.sections[0].questionIds).toEqual(['pubtype']);
    });

    it('round-trips through the app parser: options, descriptions and sections survive', () => {
      const template = buildEkkw();
      const parsed = parseFormTemplate({
        kind: 30168,
        pubkey: PUBKEY,
        tags: template.tags,
        content: '',
        created_at: 1
      });
      const pubtype = parsed.fields.find((f) => f.id === 'pubtype');
      expect(pubtype.type).toBe('radio');
      expect(pubtype.options.options.map((o) => o.label)).toEqual(['Zeitschrift', 'Sammelband']);
      const doi = parsed.fields.find((f) => f.id === 'doi');
      expect(doi.options.description).toMatch(/Digital Object Identifier/);
      expect(parsed.sections).toHaveLength(4);
      const herausgeber = parsed.fields.find((f) => f.id === 'herausgeber');
      expect(herausgeber.output).toBe('amb:contributor');
    });
  });
});
