/**
 * CurriculumTree component tests.
 *
 * Recursive lazy-loading tree: expects an array of root nodes; clicking a
 * chevron POSTs `get_node_children` to /api/curricula and renders the
 * returned children inline. Each node has three "+ T / + A / + R" action
 * buttons that emit `onaction(concept, relation)` upward.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import CurriculumTree from '../educational/CurriculumTree.svelte';

vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'de'
}));

vi.mock('$lib/paraglide/messages', () => ({
  curriculum_picker_add_to_teaches: () => 'Vermittelt',
  curriculum_picker_add_to_assesses: () => 'Prüft',
  curriculum_picker_add_to_competency_required: () => 'Voraussetzt',
  curriculum_picker_expand_node: () => 'Aufklappen',
  curriculum_picker_collapse_node: () => 'Zuklappen',
  curriculum_picker_no_children: () => 'Keine Unterthemen',
  curriculum_picker_loading: () => 'Lade…'
}));

/** @param {object} body */
function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

const PLANET = {
  id: 'https://lp-bavaria.org/lis_live_isb.c.221308.de',
  label: 'Planet Erde'
};
const VIELFALT = {
  id: 'https://lp-bavaria.org/lis_live_isb.c.221309.de',
  label: 'Vielfalt der Erde'
};
const EINZIG_CHILD = {
  id: 'https://lp-bavaria.org/3463992d',
  label: 'stellen die Einzigartigkeit des Planeten Erde dar.'
};

describe('CurriculumTree', () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(async (input, init) => {
      const body = JSON.parse(init.body);
      if (body.tool === 'get_node_children' && body.args.nodeUri === PLANET.id) {
        return jsonResponse({ items: [EINZIG_CHILD] });
      }
      if (body.tool === 'get_node_children' && body.args.nodeUri === VIELFALT.id) {
        return jsonResponse({ items: [] });
      }
      throw new Error(`Unhandled fetch: ${init.body}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders all root nodes', () => {
    const { getByText } = render(CurriculumTree, {
      props: { rootNodes: [PLANET, VIELFALT], onaction: vi.fn() }
    });
    expect(getByText('Planet Erde')).toBeTruthy();
    expect(getByText('Vielfalt der Erde')).toBeTruthy();
  });

  it('hides the expand chevron up-front for nodes the API marks hasChildren=false', () => {
    const { queryByLabelText } = render(CurriculumTree, {
      props: {
        rootNodes: [{ ...VIELFALT, hasChildren: false }],
        onaction: vi.fn()
      }
    });
    // No chevron rendered — neither "Aufklappen" nor "Zuklappen" labels exist.
    expect(queryByLabelText(`Aufklappen: ${VIELFALT.label}`)).toBeNull();
    expect(queryByLabelText(`Zuklappen: ${VIELFALT.label}`)).toBeNull();
  });

  it('expanding a node fetches and renders its children', async () => {
    const { getByLabelText, findByText } = render(CurriculumTree, {
      props: { rootNodes: [PLANET], onaction: vi.fn() }
    });
    // The expand button uses an aria-label tied to the node.
    const expandBtn = getByLabelText(`Aufklappen: Planet Erde`);
    await fireEvent.click(expandBtn);
    const childLabel = await findByText(/Einzigartigkeit/);
    expect(childLabel).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(call.tool).toBe('get_node_children');
    expect(call.args.nodeUri).toBe(PLANET.id);
  });

  it('replaces the chevron with a leaf indicator once children come back empty', async () => {
    const { getByLabelText, queryByLabelText, findByText, container } = render(CurriculumTree, {
      props: { rootNodes: [VIELFALT], onaction: vi.fn() }
    });
    await fireEvent.click(getByLabelText(`Aufklappen: Vielfalt der Erde`));
    // After fetch, no expand/collapse button remains for this node.
    await waitFor(() => {
      expect(queryByLabelText(`Aufklappen: Vielfalt der Erde`)).toBeNull();
      expect(queryByLabelText(`Zuklappen: Vielfalt der Erde`)).toBeNull();
    });
    // The label still renders, alongside a non-interactive leaf glyph.
    expect(await findByText('Vielfalt der Erde')).toBeTruthy();
    expect(container.textContent).toContain('•');
  });

  it('collapse hides children but keeps cache (no second fetch)', async () => {
    const { getByLabelText, findByText, queryByText } = render(CurriculumTree, {
      props: { rootNodes: [PLANET], onaction: vi.fn() }
    });
    await fireEvent.click(getByLabelText(`Aufklappen: Planet Erde`));
    await findByText(/Einzigartigkeit/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Collapse
    await fireEvent.click(getByLabelText(`Zuklappen: Planet Erde`));
    await waitFor(() => expect(queryByText(/Einzigartigkeit/)).toBeNull());

    // Re-expand should NOT refetch
    await fireEvent.click(getByLabelText(`Aufklappen: Planet Erde`));
    await findByText(/Einzigartigkeit/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clicking "+ teaches" calls onaction(concept, "teaches")', async () => {
    const onaction = vi.fn();
    const { getAllByLabelText } = render(CurriculumTree, {
      props: { rootNodes: [PLANET], onaction }
    });
    const addTeaches = getAllByLabelText('Vermittelt: Planet Erde')[0];
    await fireEvent.click(addTeaches);
    expect(onaction).toHaveBeenCalledOnce();
    const [concept, relation] = onaction.mock.calls[0];
    expect(concept.id).toBe(PLANET.id);
    expect(concept.type).toBe('Concept');
    expect(concept.prefLabel?.de).toBe('Planet Erde');
    expect(relation).toBe('teaches');
  });

  it('clicking "+ assesses" and "+ requires" emit the matching relation', async () => {
    const onaction = vi.fn();
    const { getAllByLabelText } = render(CurriculumTree, {
      props: { rootNodes: [PLANET], onaction }
    });
    await fireEvent.click(getAllByLabelText('Prüft: Planet Erde')[0]);
    await fireEvent.click(getAllByLabelText('Voraussetzt: Planet Erde')[0]);
    expect(onaction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: PLANET.id }),
      'assesses'
    );
    expect(onaction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: PLANET.id }),
      'competencyRequired'
    );
  });

  it('marks +T/+A/+R as active when the node is in the corresponding selected set', () => {
    const { getAllByLabelText } = render(CurriculumTree, {
      props: {
        rootNodes: [PLANET],
        selectedTeaches: [PLANET.id],
        selectedAssesses: [],
        selectedRequires: [PLANET.id],
        onaction: vi.fn()
      }
    });
    const tBtn = getAllByLabelText('Vermittelt: Planet Erde')[0];
    const aBtn = getAllByLabelText('Prüft: Planet Erde')[0];
    const rBtn = getAllByLabelText('Voraussetzt: Planet Erde')[0];
    expect(tBtn.getAttribute('aria-pressed')).toBe('true');
    expect(aBtn.getAttribute('aria-pressed')).toBe('false');
    expect(rBtn.getAttribute('aria-pressed')).toBe('true');
    expect(tBtn.className).toContain('btn-primary');
    expect(aBtn.className).toContain('btn-ghost');
    expect(rBtn.className).toContain('btn-primary');
  });

  it('children render with their own action buttons', async () => {
    const onaction = vi.fn();
    const { getByLabelText, findByText, getAllByLabelText } = render(CurriculumTree, {
      props: { rootNodes: [PLANET], onaction }
    });
    await fireEvent.click(getByLabelText(`Aufklappen: Planet Erde`));
    await findByText(/Einzigartigkeit/);

    const childAddTeaches = getAllByLabelText(`Vermittelt: ${EINZIG_CHILD.label}`)[0];
    await fireEvent.click(childAddTeaches);
    expect(onaction).toHaveBeenCalledOnce();
    expect(onaction.mock.calls[0][0].id).toBe(EINZIG_CHILD.id);
  });
});
