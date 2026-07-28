/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  form_builder_showif_label: () => 'Show only if',
  form_builder_showif_always: () => 'always',
  form_builder_showif_equals: () => 'equals',
  form_builder_showif_notEquals: () => 'is not',
  form_builder_showif_contains: () => 'contains'
}));

import FormBuilderConditionRow from '../forms/FormBuilderConditionRow.svelte';

afterEach(() => cleanup());

const availableQuestions = [
  {
    id: 'kind',
    label: 'Kind',
    type: 'radio',
    selectOptions: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' }
    ]
  }
];

describe('FormBuilderConditionRow', () => {
  it('selecting question + operator + value writes the exact displayIf object', async () => {
    let value;
    const onchange = vi.fn((v) => (value = v));
    const { container, rerender } = render(FormBuilderConditionRow, {
      props: { value: undefined, availableQuestions, onchange }
    });

    const selects = () => container.querySelectorAll('select');

    // Select the question
    await fireEvent.change(selects()[0], { target: { value: 'kind' } });
    expect(onchange).toHaveBeenCalledWith({
      rules: [{ questionId: 'kind', operator: 'equals', value: '' }]
    });
    await rerender({ value, availableQuestions, onchange });

    // Operator select should now be visible; select notEquals
    await fireEvent.change(selects()[1], { target: { value: 'notEquals' } });
    expect(value).toEqual({
      rules: [{ questionId: 'kind', operator: 'notEquals', value: '' }]
    });
    await rerender({ value, availableQuestions, onchange });

    // Value select (dropdown of option ids) — pick option 'a'
    await fireEvent.change(selects()[2], { target: { value: 'a' } });
    expect(value).toEqual({
      rules: [{ questionId: 'kind', operator: 'notEquals', value: 'a' }]
    });
  });

  it('lists the referenced question option ids in the value dropdown and stores the id, not the label', async () => {
    const onchange = vi.fn();
    const { container } = render(FormBuilderConditionRow, {
      props: {
        value: { rules: [{ questionId: 'kind', operator: 'equals', value: '' }] },
        availableQuestions,
        onchange
      }
    });

    const selects = container.querySelectorAll('select');
    const valueSelect = selects[2];
    const optionValues = Array.from(valueSelect.querySelectorAll('option')).map((o) => o.value);
    const optionLabels = Array.from(valueSelect.querySelectorAll('option')).map(
      (o) => o.textContent
    );

    expect(optionValues).toEqual(expect.arrayContaining(['a', 'b']));
    expect(optionLabels).toEqual(expect.arrayContaining(['A', 'B']));

    await fireEvent.change(valueSelect, { target: { value: 'b' } });
    expect(onchange).toHaveBeenCalledWith({
      rules: [{ questionId: 'kind', operator: 'equals', value: 'b' }]
    });
  });

  it('renders nothing when there are no earlier questions (first field)', async () => {
    const onchange = vi.fn();
    const { container } = render(FormBuilderConditionRow, {
      props: { value: undefined, availableQuestions: [], onchange }
    });

    expect(container.querySelectorAll('select').length).toBe(0);
    expect(container.textContent?.trim()).toBe('');
  });

  it('clearing the question sets value to undefined', async () => {
    const onchange = vi.fn();
    const { container } = render(FormBuilderConditionRow, {
      props: {
        value: { rules: [{ questionId: 'kind', operator: 'equals', value: 'a' }] },
        availableQuestions,
        onchange
      }
    });

    const questionSelect = container.querySelectorAll('select')[0];
    await fireEvent.change(questionSelect, { target: { value: '' } });

    expect(onchange).toHaveBeenCalledWith(undefined);
  });
});
