// @ts-nocheck
/**
 * ReportIssueModal — in-app feedback / bug report filed as a public NIP-34
 * issue. Store-driven: reads an optional prefill (subject, description, type,
 * context) from modalStore.modalProps, gates submit on subject + description
 * + a signer, hands the report to submitIssueReport, and shows a success
 * toast carrying the gitworkshop.dev link.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'report_issue_modal_title',
      'report_issue_modal_description',
      'report_issue_type_label',
      'report_issue_type_bug',
      'report_issue_type_idea',
      'report_issue_subject_label',
      'report_issue_subject_placeholder',
      'report_issue_description_label',
      'report_issue_description_placeholder',
      'report_issue_context_label',
      'report_issue_context_hint',
      'report_issue_submit',
      'report_issue_success',
      'report_issue_success_link',
      'report_issue_error',
      'report_issue_login_required',
      'common_cancel'
    ].map((k) => [k, () => k])
  )
);

const mockModalStore = vi.hoisted(() => ({
  modalProps: /** @type {any} */ ({}),
  closeModal: vi.fn()
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: mockModalStore }));

const activeUserHolder = vi.hoisted(() => ({ value: /** @type {any} */ (null) }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => activeUserHolder.value
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { appName: 'Edufeed' }
}));

const mockSubmit = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/issue-report.js', () => ({ submitIssueReport: mockSubmit }));

const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast.js', () => ({ showToast: mockShowToast }));

import ReportIssueModal from '../shared/ReportIssueModal.svelte';

const USER = { pubkey: 'a'.repeat(64), signer: { signEvent: vi.fn() } };

beforeEach(() => {
  mockModalStore.modalProps = {};
  mockModalStore.closeModal.mockReset();
  mockSubmit.mockReset();
  mockShowToast.mockReset();
  activeUserHolder.value = USER;
});

/** @param {import('@testing-library/svelte').RenderResult<any>} r */
function fields(r) {
  return {
    subject: /** @type {HTMLInputElement} */ (r.container.querySelector('#report-issue-subject')),
    description: /** @type {HTMLTextAreaElement} */ (
      r.container.querySelector('#report-issue-description')
    ),
    submit: /** @type {HTMLButtonElement} */ (r.container.querySelector('button[type="submit"]')),
    form: r.getByTestId('report-issue-form')
  };
}

describe('ReportIssueModal', () => {
  it('starts empty as a bug report with the submit disabled', () => {
    const r = render(ReportIssueModal);
    const { subject, description, submit } = fields(r);
    expect(subject.value).toBe('');
    expect(description.value).toBe('');
    expect(submit.disabled).toBe(true);
    const bug = /** @type {HTMLInputElement} */ (r.container.querySelector('input[value="bug"]'));
    expect(bug.checked).toBe(true);
    expect(r.queryByTestId('report-issue-login-hint')).toBeNull();
  });

  it('shows the automatically attached context (route, app, version, UA)', () => {
    const r = render(ReportIssueModal);
    const preview = r.getByTestId('report-issue-context').textContent;
    expect(preview).toContain('- Route: `/`');
    expect(preview).toContain('- App: Edufeed');
    expect(preview).toContain('- User agent: ');
    expect(preview).not.toContain('Error');
  });

  it('prefills subject, type and the error context handed over by RenderErrorCard', () => {
    mockModalStore.modalProps = {
      prefill: {
        type: 'bug',
        subject: 'Error: each_key_duplicate',
        description: '',
        context: {
          route: '/discover',
          appName: 'Edufeed',
          version: '0.3.4',
          userAgent: 'UA',
          errorMessage: 'each_key_duplicate',
          errorStack: 'Error: each_key_duplicate\n    at render (chunk.js:1:1)'
        }
      }
    };
    const r = render(ReportIssueModal);
    expect(fields(r).subject.value).toBe('Error: each_key_duplicate');
    const preview = r.getByTestId('report-issue-context').textContent;
    expect(preview).toContain('- Route: `/discover`');
    expect(preview).toContain('- App: Edufeed 0.3.4');
    expect(preview).toContain('**Error:** each_key_duplicate');
    expect(preview).toContain('at render (chunk.js:1:1)');
  });

  it('enables submit once subject and description are filled, then files the report', async () => {
    mockSubmit.mockResolvedValue({
      event: { id: 'ab'.repeat(32) },
      url: 'https://gitworkshop.dev/nevent1xyz',
      relays: ['wss://relay.ngit.dev']
    });
    const r = render(ReportIssueModal);
    const { subject, description, submit, form } = fields(r);

    await fireEvent.input(subject, { target: { value: 'Broken page' } });
    expect(submit.disabled).toBe(true);
    await fireEvent.input(description, { target: { value: 'It crashed' } });
    await fireEvent.click(r.container.querySelector('input[value="idea"]'));
    expect(submit.disabled).toBe(false);

    await fireEvent.submit(form);

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    const [report, user] = mockSubmit.mock.calls[0];
    expect(report.subject).toBe('Broken page');
    expect(report.description).toBe('It crashed');
    expect(report.type).toBe('idea');
    expect(report.context.route).toBe('/');
    expect(report.context.appName).toBe('Edufeed');
    expect(user).toBe(USER);

    await waitFor(() => expect(mockModalStore.closeModal).toHaveBeenCalledTimes(1));
    expect(mockShowToast).toHaveBeenCalledWith(
      'report_issue_success',
      'success',
      expect.any(Number),
      { link: { href: 'https://gitworkshop.dev/nevent1xyz', label: 'report_issue_success_link' } }
    );
  });

  it('keeps the modal open and shows an error toast when filing fails', async () => {
    mockSubmit.mockRejectedValue(new Error('no relay'));
    const r = render(ReportIssueModal);
    const { subject, description, form } = fields(r);
    await fireEvent.input(subject, { target: { value: 'S' } });
    await fireEvent.input(description, { target: { value: 'D' } });
    await fireEvent.submit(form);

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('report_issue_error', 'error'));
    expect(mockModalStore.closeModal).not.toHaveBeenCalled();
    expect(fields(r).submit.disabled).toBe(false);
  });

  it('is disabled with a hint when nobody is logged in', async () => {
    activeUserHolder.value = null;
    const r = render(ReportIssueModal);
    const { subject, description, submit, form } = fields(r);
    expect(r.getByTestId('report-issue-login-hint')).toBeTruthy();
    await fireEvent.input(subject, { target: { value: 'S' } });
    await fireEvent.input(description, { target: { value: 'D' } });
    expect(submit.disabled).toBe(true);
    await fireEvent.submit(form);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('closes via the cancel button', async () => {
    const r = render(ReportIssueModal);
    await fireEvent.click(r.getByText('common_cancel'));
    expect(mockModalStore.closeModal).toHaveBeenCalledTimes(1);
  });
});
