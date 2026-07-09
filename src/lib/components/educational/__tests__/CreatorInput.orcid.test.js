/**
 * CreatorInput ORCID field — invalid ORCIDs block saving with an error,
 * valid input is normalized to the canonical https URI on save.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import CreatorInput from '../CreatorInput.svelte';

/**
 * Open the add form and fill name + orcid
 * @param {HTMLElement} container
 * @param {{name: string, orcid: string}} values
 */
async function openAndFill(container, { name, orcid }) {
  const addButton = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.match(/add creator|autor/i)
  );
  await fireEvent.click(/** @type {Element} */ (addButton));
  const nameInput = /** @type {Element} */ (container.querySelector('#creator-name'));
  await fireEvent.input(nameInput, { target: { value: name } });
  const orcidInput = /** @type {Element} */ (container.querySelector('#creator-orcid'));
  await fireEvent.input(orcidInput, { target: { value: orcid } });
}

/**
 * Submit the inline add-creator form
 * @param {HTMLElement} container
 */
async function submit(container) {
  const form = /** @type {Element} */ (container.querySelector('form'));
  await fireEvent.submit(form);
}

describe('CreatorInput ORCID', () => {
  it('normalizes a bare ORCID to the canonical URI on save', async () => {
    const onchange = vi.fn();
    const { container } = render(CreatorInput, { props: { creators: [], onchange } });

    await openAndFill(container, { name: 'Ada', orcid: '0000-0002-1825-0097' });
    await submit(container);

    expect(onchange).toHaveBeenCalledTimes(1);
    const creators = onchange.mock.calls[0][0];
    expect(creators).toHaveLength(1);
    expect(creators[0].orcid).toBe('https://orcid.org/0000-0002-1825-0097');
    // ORCID badge is rendered for the saved creator
    expect(container.textContent).toContain('ORCID');
  });

  it('blocks save and shows an error for an invalid ORCID', async () => {
    const onchange = vi.fn();
    const { container } = render(CreatorInput, { props: { creators: [], onchange } });

    await openAndFill(container, { name: 'Ada', orcid: '0000-0002-1825-0096' });
    await submit(container);

    expect(onchange).not.toHaveBeenCalled();
    const orcidInput = container.querySelector('#creator-orcid');
    expect(orcidInput?.getAttribute('aria-invalid')).toBe('true');
  });

  it('saves without orcid key when the field is left empty', async () => {
    const onchange = vi.fn();
    const { container } = render(CreatorInput, { props: { creators: [], onchange } });

    await openAndFill(container, { name: 'Ada', orcid: '' });
    await submit(container);

    const creators = onchange.mock.calls[0][0];
    expect(creators[0]).not.toHaveProperty('orcid');
  });
});
