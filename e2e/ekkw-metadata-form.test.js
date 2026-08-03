/**
 * EKKW / Hochschulbildung metadata form as a kind-30168 nostr form template
 * driving kind-30142 resource creation — the deliverable of the research
 * thread (Buzz #edufeed-app, pad.gwdg.de/3USPZzEeROajq3MUybGoFw).
 *
 * Proves, end to end in the sandbox, everything the pad asks for that the
 * gap-closing commits enabled:
 *  - SECTIONS render as wizard steps ("Seite 4/5/6") with per-page validation
 *  - a hierarchical Theologie taxonomy: concepts carry `broader`, the picker
 *    renders the child under its parent, and picking the CHILD lands its URI
 *    in about:id on the wire
 *  - Herausgeber != Autor: a second creator field routed to amb:contributor
 *  - "Erschienen in" as a free-text container -> isPartOf {name}
 *  - Band/Heft via ext outputs (no AMB property exists for them)
 *  - per-field description texts (Erlaeuterungssatz) rendering under labels
 *
 * Template + vocab fixtures are seeded to the E2E strfry relay with
 * RUN_ID-suffixed d-tags (same pattern as amb-basic-form.test.js), and the
 * template tags are built with the app's OWN encoder (builderStateToTags) so
 * the fixture cannot drift from what the builder would publish.
 */
import { test, expect } from './fixtures.js';
import { TEST_AUTHOR } from './test-data.js';
import { RELAY_URLS, seedEventsToRelay, waitForEventOnRelay } from './relay-verification.js';
import { finalizeEvent } from 'nostr-tools/pure';
import { hexToBytes } from 'nostr-tools/utils';
import { nip19 } from 'nostr-tools';
import { buildConceptScheme, buildConcept } from 'nostr-vocab-core/blueprints';
import { builderStateToTags } from '../src/lib/helpers/forms/builder-state.js';

const RUN_ID = Date.now();
const SK = hexToBytes(TEST_AUTHOR.secretKeyHex);

/** @param {{kind:number, tags:string[][], content:string}} template */
function sign(template) {
  return finalizeEvent({ ...template, created_at: Math.floor(Date.now() / 1000) }, SK);
}

const THEO_D = `e2e-theologie-${RUN_ID}`;
const FORM_D = `e2e-ekkw-${RUN_ID}`;
const theoSchemeAddr = `39737:${TEST_AUTHOR.pubkey}:${THEO_D}`;
const PRAKTISCH_URI = `https://example.edu/theologie/praktische-${RUN_ID}`;
const RELPAED_URI = `https://example.edu/theologie/religionspaedagogik-${RUN_ID}`;

const ERLAEUTERUNG = 'Bitte beschreiben Sie den Inhalt so, dass Studierende ihn einordnen können.';
const CONTAINER_HINT = 'Zeitschrift oder Sammelband, in dem der Beitrag erschienen ist.';

/** Builder FieldState shorthand (full shape addField() would create). */
function fs(over) {
  return {
    defaultValue: '',
    required: false,
    placeholder: '',
    description: '',
    min: undefined,
    max: undefined,
    selectOptions: [],
    multiple: false,
    vocab: undefined,
    output: '',
    ...over
  };
}

/** The EKKW builder state: 4 sections mirroring the pad's step structure. */
const BUILDER_STATE = [
  { id: 'sec-typ', type: 'section', title: 'Publikationstyp' },
  fs({
    id: 'pubtype',
    type: 'radio',
    label: 'Art der Publikation',
    required: true,
    selectOptions: [
      { id: 'zeitschrift', label: 'Zeitschrift' },
      { id: 'sammelband', label: 'Sammelband' }
    ],
    output: 'ext'
  }),
  { id: 'sec-pub', type: 'section', title: 'Wissenschaftliche Publikation' },
  fs({ id: 'doi', type: 'text', label: 'DOI', output: 'amb:id' }),
  fs({
    id: 'container',
    type: 'amb-relation',
    label: 'Erschienen in',
    description: CONTAINER_HINT,
    output: 'amb:isPartOf'
  }),
  fs({ id: 'band', type: 'text', label: 'Band', output: 'ext' }),
  fs({ id: 'heft', type: 'text', label: 'Heft', output: 'ext' }),
  { id: 'sec-inhalt', type: 'section', title: 'Inhalt' },
  fs({ id: 'name', type: 'text', label: 'Titel', required: true, output: 'amb:name' }),
  fs({
    id: 'description',
    type: 'textarea',
    label: 'Beschreibung',
    description: ERLAEUTERUNG,
    output: 'amb:description'
  }),
  fs({
    id: 'fach',
    type: 'select',
    label: 'Fachsystematik',
    vocab: { address: theoSchemeAddr, relay: RELAY_URLS.strfry },
    output: 'amb:about'
  }),
  { id: 'sec-personen', type: 'section', title: 'Personen' },
  fs({ id: 'autoren', type: 'creator', label: 'Autoren', output: 'amb:creator' }),
  fs({ id: 'herausgeber', type: 'creator', label: 'Herausgeber', output: 'amb:contributor' })
];

async function seedFixtures() {
  const theoScheme = sign(
    buildConceptScheme({ d: THEO_D, prefLabels: [{ value: 'Theologie (E2E)', lang: 'de' }] })
  );
  const praktische = sign(
    buildConcept({
      d: `praktische-${RUN_ID}`,
      prefLabels: [{ value: 'Praktische Theologie', lang: 'de' }],
      inScheme: { address: theoSchemeAddr, relay: RELAY_URLS.strfry },
      externalUri: PRAKTISCH_URI
    })
  );
  const relpaedTemplate = buildConcept({
    d: `religionspaedagogik-${RUN_ID}`,
    prefLabels: [{ value: 'Religionspädagogik', lang: 'de' }],
    inScheme: { address: theoSchemeAddr, relay: RELAY_URLS.strfry },
    externalUri: RELPAED_URI,
    broader: [
      {
        address: `39738:${TEST_AUTHOR.pubkey}:praktische-${RUN_ID}`,
        relay: RELAY_URLS.strfry
      }
    ]
  });
  const relpaed = sign(relpaedTemplate);

  const formTags = builderStateToTags(BUILDER_STATE, {
    dTag: FORM_D,
    name: 'EKKW Lernmetadaten (E2E)',
    description: 'E2E fixture for the EKKW higher-education metadata form.'
  });
  const formTemplate = sign({ kind: 30168, tags: formTags, content: '' });

  await seedEventsToRelay([theoScheme, praktische, relpaed, formTemplate], {
    relay: RELAY_URLS.strfry
  });

  return {
    naddr: nip19.naddrEncode({
      kind: 30168,
      pubkey: TEST_AUTHOR.pubkey,
      identifier: FORM_D,
      relays: [RELAY_URLS.strfry]
    })
  };
}

test.describe('EKKW metadata form (30168 template with steps → kind 30142)', () => {
  /** @type {string} */
  let naddr;

  test.beforeAll(async () => {
    ({ naddr } = await seedFixtures());
  });

  test('walks the paged wizard and publishes a 30142 with contributor, isPartOf name, ext Band/Heft and a tree-picked concept', async ({
    authenticatedPage: page
  }) => {
    test.setTimeout(180000);
    const title = `EKKW E2E Beitrag ${RUN_ID}`;
    const beschreibung = 'Ein Beitrag zur religionspädagogischen Hochschullehre.';
    const doi = '10.1000/ekkw-e2e';
    const journal = 'Zeitschrift für Pädagogik und Theologie';

    await page.goto(`/forms/${naddr}/create-resource`);

    // ---- Page 1: Publikationstyp (a section page; Titel is NOT here) ----
    await expect(page.getByText('Publikationstyp')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#name')).toHaveCount(0);
    await page.getByText('Zeitschrift', { exact: true }).click();
    await page.locator('button:has-text("Next")').click();

    // ---- Page 2: Wissenschaftliche Publikation ----
    await expect(page.locator('#doi')).toBeVisible();
    // the field description (Erläuterungssatz) renders under the label
    await expect(page.getByText(CONTAINER_HINT)).toBeVisible();
    await page.locator('#doi').fill(doi);
    const containerInput = page.locator('[data-testid="relation-name-input"]');
    await containerInput.fill(journal);
    await containerInput.press('Enter');
    await expect(page.getByText(journal)).toBeVisible();
    await page.locator('#band').fill('42');
    await page.locator('#heft').fill('3');
    await page.locator('button:has-text("Next")').click();

    // ---- Page 3: Inhalt — hierarchy in the concept picker ----
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.getByText(ERLAEUTERUNG)).toBeVisible();
    await page.locator('#name').fill(title);
    await page.locator('#description').fill(beschreibung);

    const fachControl = page.locator('.form-control').filter({ hasText: 'Fachsystematik' });
    const trigger = fachControl.locator('button.select-trigger');
    await expect(trigger).toBeVisible({ timeout: 15000 });
    await expect(trigger).not.toContainText('Loading', { timeout: 15000 });
    await trigger.click();
    const dropdown = fachControl.locator('.dropdown');
    await expect(dropdown.locator('.dropdown-content')).toBeVisible({ timeout: 5000 });
    // both parent and child are offered; pick the CHILD (proves the broader
    // relation survived into the rendered tree)
    await expect(
      dropdown.locator('.dropdown-content button').filter({ hasText: 'Praktische Theologie' })
    ).toBeVisible();
    await dropdown
      .locator('.dropdown-content button')
      .filter({ hasText: 'Religionspädagogik' })
      .click();
    await page.locator('button:has-text("Next")').click();

    // ---- Page 4: Personen — Autoren (self) + Herausgeber (manual, ORCID) ----
    const autorenControl = page.locator('.form-control').filter({ hasText: 'Autoren' });
    await autorenControl.locator('.creator-add-self').click();
    await page.waitForTimeout(2500);

    const editorControl = page.locator('.form-control').filter({ hasText: 'Herausgeber' });
    await editorControl.locator('button:has-text("Add Creator")').click();
    await editorControl.getByPlaceholder('Enter name').fill('Erik Editor');
    await editorControl.getByPlaceholder(/orcid/i).fill('0000-0001-5109-3700');
    await editorControl.locator('button[type="submit"]').click();
    await expect(editorControl.getByText('Erik Editor')).toBeVisible();

    await page.locator('button:has-text("Submit")').click();

    // ---- Published: a kind-30142 resource ----
    // NOT /\/naddr1…/: the CURRENT url (/forms/<naddr>/create-resource)
    // already matches that, so waitForURL would resolve instantly and hand
    // back the TEMPLATE's naddr (kind 30168) instead of the resource's.
    await page.waitForURL((url) => /^\/naddr1[a-z0-9]+\/?$/i.test(new URL(url).pathname), {
      timeout: 20000
    });
    const resourceNaddr = /** @type {RegExpMatchArray} */ (
      new URL(page.url()).pathname.match(/naddr1[a-z0-9]+/i)
    )[0];
    const decoded = nip19.decode(resourceNaddr);
    expect(decoded.type).toBe('naddr');
    const {
      pubkey: resPubkey,
      identifier: resD,
      kind: resKind
    } = /** @type {any} */ (decoded.data);
    expect(resKind).toBe(30142);

    const event = await waitForEventOnRelay(
      { kinds: [30142], authors: [resPubkey], '#d': [resD] },
      (/** @type {{ tags: string[][] }} */ e) =>
        e.tags.some((t) => t[0] === 'name' && t[1] === title),
      { relay: RELAY_URLS.amb, timeout: 60000 }
    );

    /** @param {string} key @returns {string[][]} */
    const tagsFor = (key) => event.tags.filter((/** @type {string[]} */ t) => t[0] === key);
    /** @param {string} prefix @returns {string[][]} */
    const tagsWithPrefix = (prefix) =>
      event.tags.filter((/** @type {string[]} */ t) => t[0].startsWith(prefix));

    expect(tagsFor('name')[0]?.[1]).toBe(title);
    expect(tagsFor('description')[0]?.[1]).toBe(beschreibung);

    // gap 3: Herausgeber landed as contributor, with the normalized ORCID URI
    const contributorTags = tagsWithPrefix('contributor');
    expect(contributorTags.some((t) => t[1] === 'Erik Editor')).toBe(true);
    expect(contributorTags.some((t) => t[1] === 'https://orcid.org/0000-0001-5109-3700')).toBe(
      true
    );
    // ... and the self-added author is a creator, untouched by the editors
    expect(
      event.tags.some(
        (/** @type {string[]} */ t) => t[0] === 'p' && t[1] === resPubkey && t[3] === 'creator'
      )
    ).toBe(true);

    // gap 2: free-text container as isPartOf {name}
    const isPartOfTags = tagsWithPrefix('isPartOf');
    expect(isPartOfTags.some((t) => t[1] === journal)).toBe(true);

    // Band/Heft via ext outputs: ext:<form-dTag>:<field-id>
    expect(tagsFor(`ext:${FORM_D}:band`)[0]?.[1]).toBe('42');
    expect(tagsFor(`ext:${FORM_D}:heft`)[0]?.[1]).toBe('3');
    expect(tagsFor(`ext:${FORM_D}:pubtype`).length).toBeGreaterThan(0);

    // the tree-picked CHILD concept
    expect(tagsFor('about:id')[0]?.[1]).toBe(RELPAED_URI);

    // DOI landed on the id output
    expect(event.tags.some((/** @type {string[]} */ t) => t.includes(doi))).toBe(true);

    // informative form back-reference
    expect(
      tagsFor('a').some((t) => t[1] === `30168:${TEST_AUTHOR.pubkey}:${FORM_D}` && t[3] === 'form')
    ).toBe(true);
  });
});
