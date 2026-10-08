/**
 * In-app issue reporting — sign and publish a NIP-34 issue (kind 1621).
 *
 * Relay set = the user's NIP-65 write relays + the maintainers' read relays
 * (they are p-tagged) + the repository announcement's `relays` — the same
 * places `ngit issue create` would send it, so gitworkshop.dev and ngit list
 * the issue right away.
 */

import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { publishEvent } from '$lib/services/publish-service.js';
import {
  ISSUE_REPORT_REPO,
  buildIssueTemplate,
  issueGitworkshopUrl
} from '$lib/helpers/issue-report.js';

/**
 * @typedef {Object} IssueReportResult
 * @property {import('nostr-tools').NostrEvent} event  The signed issue
 * @property {string} url                               gitworkshop.dev link
 * @property {string[]} relays                          Relays that accepted it
 */

/**
 * File a report as a public issue, signed by the active account.
 *
 * @param {{
 *   subject: string,
 *   description: string,
 *   type: import('$lib/helpers/issue-report.js').IssueReportType,
 *   context: import('$lib/helpers/issue-report.js').IssueReportContext
 * }} report
 * @param {{ signer?: any, pubkey?: string } | null | undefined} activeUser
 * @returns {Promise<IssueReportResult>}
 * @throws when there is no signer, signing is refused, or no relay accepted the event
 */
export async function submitIssueReport(report, activeUser) {
  if (!activeUser?.signer) throw new Error('Sign in to report an issue');

  const factory = createAppEventFactory({ signer: activeUser.signer });
  const draft = await factory.build(buildIssueTemplate(report));
  const signed = await factory.sign(draft);

  const result = await publishEvent(signed, [...ISSUE_REPORT_REPO.maintainers], {
    additionalRelays: [...ISSUE_REPORT_REPO.relays]
  });
  if (!result.success) throw new Error('No relay accepted the issue');

  const accepted = (result.results ?? []).filter((r) => r.success).map((r) => r.relay);
  return { event: signed, url: issueGitworkshopUrl(signed), relays: accepted };
}
