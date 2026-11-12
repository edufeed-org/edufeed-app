/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import WerkbankStep from '../assistant/werkbank/WerkbankStep.svelte';

const base = {
  n: 1,
  lessonState: {
    phase: 1,
    frame: {},
    competences: [],
    didactics: {},
    plan: [],
    parts: { lessons: [] }
  },
  found: [],
  isCurrent: true,
  busy: false,
  hasParts: false,
  onpatch: vi.fn(),
  onnext: vi.fn(),
  onadapt: vi.fn()
};
/** @param {Record<string, any>} props */
const mount = (props) => render(WerkbankStep, { props: { ...base, onpatch: vi.fn(), ...props } });
/** @param {Record<string, any>} extra */
const stateWith = (extra) => ({ ...base.lessonState, ...extra });

describe('WerkbankStep', () => {
  it('n=1: changing the grade patches the frame', async () => {
    const onpatch = vi.fn();
    const view = mount({ onpatch });
    await fireEvent.change(view.getByLabelText(m.termi_werkbank_field_grade()), {
      target: { value: '5' }
    });
    expect(onpatch).toHaveBeenCalledWith({ frame: { grade: '5' } });
  });

  it('n=2: chosen are ticked, found are not; unticking removes one', async () => {
    const onpatch = vi.fn();
    const view = mount({
      n: 2,
      onpatch,
      lessonState: stateWith({ competences: [{ label: 'a' }, { label: 'b' }] }),
      found: [{ label: 'c', uri: 'https://x/c' }]
    });
    const boxes = view.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    expect(boxes.filter((b) => /** @type {HTMLInputElement} */ (b).checked)).toHaveLength(2);
    await fireEvent.click(boxes[0]);
    expect(onpatch).toHaveBeenCalledWith({ competences: [{ label: 'b' }] });
    await fireEvent.click(boxes[2]);
    expect(onpatch).toHaveBeenLastCalledWith({
      competences: [{ label: 'a' }, { label: 'b' }, { label: 'c', uri: 'https://x/c' }]
    });
  });

  it('n=2: an own goal is appended', async () => {
    const onpatch = vi.fn();
    const view = mount({
      n: 2,
      onpatch,
      lessonState: stateWith({ competences: [{ label: 'a' }] })
    });
    await fireEvent.input(view.getByLabelText(m.termi_werkbank_own_goal()), {
      target: { value: 'Brüche kürzen' }
    });
    await fireEvent.click(view.getByRole('button', { name: m.termi_werkbank_add_goal() }));
    expect(onpatch).toHaveBeenCalledWith({
      competences: [{ label: 'a' }, { label: 'Brüche kürzen' }]
    });
  });

  it('n=4: editing a goal patches the plan, the other rows unchanged', async () => {
    const onpatch = vi.fn();
    const plan = [
      { n: 1, goal: 'x', phases: ['Einstieg'], material: ['AB'] },
      { n: 2, goal: 'y' }
    ];
    const view = mount({ n: 4, onpatch, lessonState: stateWith({ plan }) });
    const goals = view.getAllByTestId('werkbank-plan-goal');
    await fireEvent.change(goals[1], { target: { value: 'z' } });
    expect(onpatch).toHaveBeenCalledWith({ plan: [plan[0], { n: 2, goal: 'z' }] });
  });

  it('"Weiter" only on the current step and disabled while busy', () => {
    expect(mount({ isCurrent: false }).queryByTestId('werkbank-next')).toBeNull();
    const view = mount({ busy: true });
    expect(/** @type {HTMLButtonElement} */ (view.getByTestId('werkbank-next')).disabled).toBe(
      true
    );
  });

  it('"Weiter" calls onnext', async () => {
    const onnext = vi.fn();
    const view = mount({ onnext });
    await fireEvent.click(view.getByTestId('werkbank-next'));
    expect(onnext).toHaveBeenCalled();
  });

  it('the not-rewritten note and adapt button only with parts on a past step', async () => {
    const note = m.termi_werkbank_parts_not_rewritten();
    expect(mount({ hasParts: true, isCurrent: true }).queryByText(note)).toBeNull();
    expect(mount({ hasParts: false, isCurrent: false }).queryByText(note)).toBeNull();
    const onadapt = vi.fn();
    const view = mount({ hasParts: true, isCurrent: false, onadapt });
    expect(view.getByText(note)).toBeTruthy();
    await fireEvent.click(view.getByRole('button', { name: m.termi_werkbank_adapt_parts() }));
    expect(onadapt).toHaveBeenCalled();
  });

  it('a rejected patch (onpatch returns false) puts the control back and keeps the own goal', async () => {
    const onpatch = vi.fn(() => false);
    const view = mount({
      n: 2,
      onpatch,
      lessonState: stateWith({ competences: [{ label: 'a' }] }),
      found: [{ label: 'c' }]
    });
    const boxes = /** @type {HTMLInputElement[]} */ (view.getAllByRole('checkbox'));
    await fireEvent.click(boxes[0]);
    await fireEvent.click(boxes[1]);
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    const goal = /** @type {HTMLInputElement} */ (view.getByLabelText(m.termi_werkbank_own_goal()));
    await fireEvent.input(goal, { target: { value: 'Neu' } });
    await fireEvent.click(view.getByRole('button', { name: m.termi_werkbank_add_goal() }));
    expect(goal.value).toBe('Neu');

    const frame = mount({ onpatch });
    const grade = /** @type {HTMLInputElement} */ (
      frame.getByLabelText(m.termi_werkbank_field_grade())
    );
    await fireEvent.change(grade, { target: { value: '5' } });
    expect(grade.value).toBe('');
  });
});
