/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nip19 } from 'nostr-tools';

import { buildFormTemplate } from '../publish-forms-build.mjs';
import { parseFormTemplate } from '../../../src/lib/helpers/forms/format.js';

const forms = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../data/edufeed-forms.json', import.meta.url)), 'utf8')
).forms;
const amb = forms.find((f) => f.d === 'amb-basic');

const PUBKEY = 'ab'.repeat(32);
const RELAY = 'wss://relay.example/';

/** Synthetic scheme naddr so vocabRef resolution works without real env. */
function fakeNaddr(identifier) {
  return nip19.naddrEncode({ kind: 39737, pubkey: PUBKEY, identifier, relays: [RELAY] });
}

describe('amb-basic template', () => {
  it('exists in the data file', () => {
    expect(amb).toBeTruthy();
  });

  describe('builds NIP-101 tags and round-trips with AMB field-output bindings', () => {
    beforeEach(() => {
      // stub every SCHEME_NADDR_* env var this form's vocabRef fields resolve through
      const vocabRefs = new Set(amb.fields.filter((f) => f.vocabRef).map((f) => f.vocabRef));
      for (const ref of vocabRefs) {
        vi.stubEnv(`SCHEME_NADDR_${ref.toUpperCase().replace(/-/g, '_')}`, fakeNaddr(ref));
      }
    });
    afterEach(() => vi.unstubAllEnvs());

    it('round-trips the AMB field-output/field-vocab bindings', () => {
      const template = buildFormTemplate(amb);
      expect(template.tags.some((t) => t[0] === 'settings')).toBe(true);

      const parsed = parseFormTemplate({
        kind: 30168,
        pubkey: PUBKEY,
        content: '',
        created_at: 0,
        tags: template.tags
      });

      // title field maps to amb:name
      const nameField = parsed.fields.find((f) => f.output === 'amb:name');
      expect(nameField).toBeTruthy();
      expect(nameField.type).toBe('text');

      // a concept field carries a field-vocab binding
      expect(parsed.fields.some((f) => f.vocab?.address)).toBe(true);

      // a creator field is present with the creator renderElement
      expect(parsed.fields.some((f) => f.type === 'creator')).toBe(true);

      // an amb-relation field is present
      expect(parsed.fields.some((f) => f.type === 'amb-relation')).toBe(true);

      // an external-urls field is present
      expect(parsed.fields.some((f) => f.type === 'external-urls')).toBe(true);

      // a date field is present
      expect(parsed.fields.some((f) => f.type === 'date')).toBe(true);
    });
  });
});
