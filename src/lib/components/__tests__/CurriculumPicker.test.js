/**
 * CurriculumPicker component tests.
 *
 * Renders four cascading <select> elements (Bundesland → Schulart → Schulfach
 * → Lehrplan), then a <CurriculumTree> for topic browsing. Each tree action
 * fires `onadd(concept, relation)`; chip × buttons fire `onremove(id, relation)`.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import CurriculumPicker from '../educational/CurriculumPicker.svelte';

vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'de'
}));

vi.mock('$lib/paraglide/messages', () => ({
  curriculum_picker_bundesland: () => 'Bundesland',
  curriculum_picker_schulart: () => 'Schulart',
  curriculum_picker_schulfach: () => 'Schulfach',
  curriculum_picker_lehrplan: () => 'Lehrplan',
  curriculum_picker_topic: () => 'Thema',
  curriculum_picker_choose: () => 'Bitte wählen…',
  curriculum_picker_loading: () => 'Lade…',
  curriculum_picker_add_to_teaches: () => 'Vermittelt',
  curriculum_picker_add_to_assesses: () => 'Prüft',
  curriculum_picker_add_to_competency_required: () => 'Voraussetzt',
  curriculum_picker_expand_node: () => 'Aufklappen',
  curriculum_picker_collapse_node: () => 'Zuklappen',
  curriculum_picker_no_children: () => 'Keine Unterthemen',
  curriculum_picker_remove_concept: () => 'Entfernen',
  curriculum_picker_section_teaches: () => 'Vermittelt',
  curriculum_picker_section_assesses: () => 'Prüft',
  curriculum_picker_section_competency_required: () => 'Voraussetzt',
  curriculum_picker_empty_section: () => 'Noch keine ausgewählt'
}));

/** @param {object} body */
function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

const BAYERN = 'https://w3id.org/lehrplan/ontology/LP_3000051';
const GYMNASIUM = 'https://w3id.org/schulart/BY_0000005';
const GEOGRAPHIE = 'https://w3id.org/schulfach/BY_0000030';
const LEHRPLAN = 'https://lp-bavaria.org/lis_live_isb.c.221348.de';
const PLANET = 'https://lp-bavaria.org/lis_live_isb.c.221308.de';

describe('CurriculumPicker', () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async (input, init) => {
      const body = JSON.parse(init.body);
      if (body.tool === 'list_bundeslaender') {
        return jsonResponse({ items: [{ id: BAYERN, label: 'Bayern' }] });
      }
      if (body.tool === 'list_schularten') {
        return jsonResponse({ items: [{ id: GYMNASIUM, label: 'Gymnasium' }] });
      }
      if (body.tool === 'list_schulfaecher') {
        return jsonResponse({ items: [{ id: GEOGRAPHIE, label: 'Geographie' }] });
      }
      if (body.tool === 'find_lehrplaene') {
        return jsonResponse({ items: [{ id: LEHRPLAN, label: 'Geographie 5' }] });
      }
      if (body.tool === 'get_node_children' && body.args.nodeUri === LEHRPLAN) {
        return jsonResponse({ items: [{ id: PLANET, label: 'Planet Erde' }] });
      }
      if (body.tool === 'get_node_children') {
        return jsonResponse({ items: [] });
      }
      throw new Error(`Unhandled tool: ${body.tool}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Drill the cascade all the way to the Lehrplan being selected.
   * @param {any} rendered
   */
  async function drillToLehrplan(rendered) {
    const { findByLabelText } = rendered;
    const bundesland = /** @type {HTMLSelectElement} */ (await findByLabelText('Bundesland'));
    await waitFor(() => expect(bundesland.querySelectorAll('option').length).toBeGreaterThan(1));
    await fireEvent.change(bundesland, { target: { value: BAYERN } });
    const schulart = /** @type {HTMLSelectElement} */ (await findByLabelText('Schulart'));
    await waitFor(() => expect(schulart.disabled).toBe(false));
    await fireEvent.change(schulart, { target: { value: GYMNASIUM } });
    const schulfach = /** @type {HTMLSelectElement} */ (await findByLabelText('Schulfach'));
    await waitFor(() => expect(schulfach.disabled).toBe(false));
    await fireEvent.change(schulfach, { target: { value: GEOGRAPHIE } });
    const lehrplan = /** @type {HTMLSelectElement} */ (await findByLabelText('Lehrplan'));
    await waitFor(() => expect(lehrplan.disabled).toBe(false));
    await fireEvent.change(lehrplan, { target: { value: LEHRPLAN } });
  }

  it('fetches Bundesländer on mount', async () => {
    const { findByLabelText } = render(CurriculumPicker, {
      props: {
        teaches: [],
        assesses: [],
        competencyRequired: [],
        onadd: vi.fn(),
        onremove: vi.fn()
      }
    });
    const bundesland = /** @type {HTMLSelectElement} */ (await findByLabelText('Bundesland'));
    await waitFor(() => expect(bundesland.textContent).toContain('Bayern'));
  });

  it('downstream selects start disabled', async () => {
    const { findByLabelText } = render(CurriculumPicker, {
      props: {
        teaches: [],
        assesses: [],
        competencyRequired: [],
        onadd: vi.fn(),
        onremove: vi.fn()
      }
    });
    const schulart = /** @type {HTMLSelectElement} */ (await findByLabelText('Schulart'));
    const schulfach = /** @type {HTMLSelectElement} */ (await findByLabelText('Schulfach'));
    const lehrplan = /** @type {HTMLSelectElement} */ (await findByLabelText('Lehrplan'));
    expect(schulart.disabled).toBe(true);
    expect(schulfach.disabled).toBe(true);
    expect(lehrplan.disabled).toBe(true);
  });

  it('selecting a Lehrplan loads root tree nodes via get_node_children', async () => {
    const onadd = vi.fn();
    const rendered = render(CurriculumPicker, {
      props: { teaches: [], assesses: [], competencyRequired: [], onadd, onremove: vi.fn() }
    });
    await drillToLehrplan(rendered);
    await rendered.findByText('Planet Erde');
    const calls = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    const childrenCall = calls.find(
      (c) => c.tool === 'get_node_children' && c.args?.nodeUri === LEHRPLAN
    );
    expect(childrenCall).toBeTruthy();
  });

  it('clicking a tree action button calls onadd with the concept and relation', async () => {
    const onadd = vi.fn();
    const rendered = render(CurriculumPicker, {
      props: { teaches: [], assesses: [], competencyRequired: [], onadd, onremove: vi.fn() }
    });
    await drillToLehrplan(rendered);
    const planetTeaches = await rendered.findByLabelText('Vermittelt: Planet Erde');
    await fireEvent.click(planetTeaches);
    expect(onadd).toHaveBeenCalledOnce();
    const [concept, relation] = onadd.mock.calls[0];
    expect(concept.id).toBe(PLANET);
    expect(concept.type).toBe('Concept');
    expect(concept.prefLabel?.de).toBe('Planet Erde');
    expect(relation).toBe('teaches');
  });

  it('renders chip lists from the teaches/assesses/competencyRequired props', () => {
    const { getByText, queryByText } = render(CurriculumPicker, {
      props: {
        teaches: [{ id: 'urn:t1', type: 'Concept', prefLabel: { de: 'Topic T1' } }],
        assesses: [{ id: 'urn:a1', type: 'Concept', prefLabel: { de: 'Topic A1' } }],
        competencyRequired: [],
        onadd: vi.fn(),
        onremove: vi.fn()
      }
    });
    expect(getByText('Topic T1')).toBeTruthy();
    expect(getByText('Topic A1')).toBeTruthy();
    // empty competencyRequired section shows the empty-state hint
    expect(queryByText('Noch keine ausgewählt')).toBeTruthy();
  });

  it('clicking a chip × calls onremove(id, relation)', async () => {
    const onremove = vi.fn();
    const { getByLabelText } = render(CurriculumPicker, {
      props: {
        teaches: [{ id: 'urn:t1', type: 'Concept', prefLabel: { de: 'Topic T1' } }],
        assesses: [],
        competencyRequired: [],
        onadd: vi.fn(),
        onremove
      }
    });
    const removeBtn = getByLabelText('Entfernen: Topic T1');
    await fireEvent.click(removeBtn);
    expect(onremove).toHaveBeenCalledWith('urn:t1', 'teaches');
  });
});
