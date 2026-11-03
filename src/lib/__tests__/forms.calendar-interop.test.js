/** @vitest-environment node */
/**
 * Interop with the edufeed WordPress plugin (wp-plugin-amb-nostr,
 * nostr-calendar-input): its shared calendar template, a community copy and
 * anonymous one-time-key responses — all produced by the plugin's own PHP
 * classes, see scripts/fixtures/generate-calendar-form-fixtures.php — must
 * parse, decrypt and compose the same calendar event here.
 *
 * THROWAWAY-community-secret.hex is a test-only key (never used on a relay).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyEvent } from 'nostr-tools/pure';
import { hexToBytes } from 'nostr-tools/utils';
import { PrivateKeySigner } from 'applesauce-signers';
import {
  parseFormTemplate,
  parseResponseTags,
  nip44DecryptWith,
  formEventToNaddr
} from '$lib/helpers/forms.js';
import {
  isCalendarOutputTemplate,
  responseToCalendarDraft
} from '$lib/helpers/forms/calendar-output.js';

const dir = fileURLToPath(new URL('./fixtures/calendar-forms/', import.meta.url));
/** @param {string} name */
const fixture = (name) => JSON.parse(readFileSync(dir + name, 'utf8'));

const shared = fixture('shared-template.json');
const copy = fixture('community-copy.json');
const communitySecret = readFileSync(dir + 'THROWAWAY-community-secret.hex', 'utf8').trim();

const LEVEL_C = 'https://w3id.org/kim/educationalLevel/level_C';
/** @param {string} uri */
const kimLabels = (uri) =>
  uri === LEVEL_C ? { de: 'Fortbildung', en: 'Advanced training' } : undefined;

const SHARED_PUBKEY = 'bdc21f93b1e2cb75608cecd7a0a00a779779d9367dc9798bd9f213f06c95bc48';

/** @param {import('nostr-tools').NostrEvent} response */
async function decrypt(response) {
  const signer = new PrivateKeySigner(hexToBytes(communitySecret));
  const plaintext = await nip44DecryptWith(signer, response.pubkey, response.content);
  return JSON.parse(plaintext);
}

describe('WordPress calendar form → edufeed-app', () => {
  it('parses the community copy as the shared calendar form, forked from edufeed', async () => {
    expect(verifyEvent(copy)).toBe(true);
    const signer = new PrivateKeySigner(hexToBytes(communitySecret));
    expect(copy.pubkey).toBe(await signer.getPublicKey());

    const form = parseFormTemplate(copy);
    expect(isCalendarOutputTemplate(form)).toBe(true);
    expect(form.dTag).toBe('edufeed-calendar-event');
    expect(form.forkOf).toEqual({
      address: `30168:${SHARED_PUBKEY}:edufeed-calendar-event`,
      relay: 'wss://relay.edufeed.org'
    });
    // Same fields as the shared template, so the copy is "current".
    expect(form.fields).toEqual(parseFormTemplate({ ...shared, pubkey: SHARED_PUBKEY }).fields);
    const start = form.fields.find((f) => f.id === 'start');
    expect(start?.type).toBe('datetime');
    expect(start?.options?.allDayField).toBe('allday');
    expect(form.fields.find((f) => f.id === 'level')?.vocab?.address).toBe(
      '39737:d2689e2f41dabfba953da26655a94ce2aa4e029c383ee921c6a4deafab99a612:educational-level'
    );
    expect(formEventToNaddr(copy, [])).toMatch(/^naddr1/);
  });

  for (const name of ['worked-example', 'all-day']) {
    it(`decrypts and composes the ${name} response like the plugin`, async () => {
      const response = fixture(`response-${name}.json`);
      expect(verifyEvent(response)).toBe(true);
      // A one-time key: not the community, addressed to it, encrypted.
      expect(response.pubkey).not.toBe(copy.pubkey);
      expect(response.tags).toEqual([
        ['a', `30168:${copy.pubkey}:edufeed-calendar-event`],
        ['p', copy.pubkey],
        ['encrypted']
      ]);

      const form = parseFormTemplate(copy);
      const values = parseResponseTags(await decrypt(response), form.fields);
      const draft = responseToCalendarDraft(form, values, { conceptLabels: kimLabels });
      expect(draft).toEqual(fixture(`wp-composed-${name}.json`));
    });
  }

  it('gets the wiki worked-example tags from the plugin-made response', async () => {
    const form = parseFormTemplate(copy);
    const values = parseResponseTags(
      await decrypt(fixture('response-worked-example.json')),
      form.fields
    );
    expect(responseToCalendarDraft(form, values, { conceptLabels: kimLabels })).toEqual({
      kind: 31923,
      content: '',
      tags: [
        ['title', 'OER-Werkstatt'],
        ['start', '1795179600'],
        ['end', '1795186800'],
        ['start_tzid', 'Europe/Berlin'],
        ['end_tzid', 'Europe/Berlin'],
        ['D', '20777'],
        ['participant', 'Jane Doe', '', 'speaker'],
        ['eventAttendanceMode', 'https://schema.org/OnlineEventAttendanceMode'],
        ['educationalLevel:id', LEVEL_C],
        ['educationalLevel:prefLabel:de', 'Fortbildung'],
        ['educationalLevel:prefLabel:en', 'Advanced training'],
        ['educationalLevel:type', 'Concept']
      ]
    });
  });
});
