/**
 * In-app issue reporting — pure builders for a NIP-34 kind 1621 issue.
 *
 * Reports (feedback from the help menu, "report this error" from
 * RenderErrorCard) become public issues on the edufeed-app repository
 * announcement of the lead maintainer, exactly like `ngit issue create`.
 * Everything here is side-effect free; signing and publishing live in
 * `$lib/services/issue-report.js`.
 *
 * Privacy contract: the only context that ever gets attached is the route
 * path (no query, no hash — call-pass codes travel in the hash), the app
 * name/version/origin, the user agent and — for render errors — the error
 * message plus a trimmed stack. Never event content, keys or account data.
 */

import { nip19 } from 'nostr-tools';
import { getAppVersion } from '$lib/helpers/app-version.js';

/** @typedef {'bug' | 'idea'} IssueReportType */

/**
 * @typedef {Object} IssueReportContext
 * @property {string} route            Path of the page the report was made on
 * @property {string} [origin]         Deployment origin (https://…)
 * @property {string} [appName]        Deployment name (APP_NAME)
 * @property {string} [version]        package.json version baked into the build
 * @property {string} userAgent        navigator.userAgent
 * @property {string} errorMessage     Empty for plain feedback
 * @property {string} errorStack       Trimmed stack, empty when unknown
 */

/**
 * The repository every in-app report is filed against: laoc's kind 30617
 * announcement for `edufeed-app` (its `relays` and `maintainers` tags,
 * mirrored here so filing needs no network round-trip first).
 */
export const ISSUE_REPORT_REPO = Object.freeze({
  ownerPubkey: '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6',
  identifier: 'edufeed-app',
  coordinate: '30617:1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6:edufeed-app',
  relays: Object.freeze([
    'wss://relay.ngit.dev',
    'wss://gitnostr.com',
    'wss://ngit.danconwaydev.com',
    'wss://groups.edufeed.org'
  ]),
  maintainers: Object.freeze([
    '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6',
    'df1a6a03242313e7430d6eae585c3f48e0ac3be2bd610e8e4f3797538bde4363',
    '28d7ca9cba0e40f59843cd1cd507c1a912919769f4495a0f38df2b0ab0238bc4'
  ])
});

/** Label every in-app report carries so maintainers can filter them. */
export const IN_APP_REPORT_LABEL = 'in-app-report';

/** Report type → NIP-34 `t` label (ngit's conventional names). */
const TYPE_LABELS = /** @type {Record<IssueReportType, string>} */ ({
  bug: 'bug',
  idea: 'feature'
});

export const STACK_LINE_LIMIT = 15;

/**
 * Keep the first `limit` lines of a stack trace; append a marker for the rest.
 * @param {string | undefined | null} stack
 * @param {number} [limit]
 * @returns {string}
 */
export function trimStack(stack, limit = STACK_LINE_LIMIT) {
  if (!stack) return '';
  const lines = stack.split('\n');
  if (lines.length <= limit) return stack;
  const rest = lines.length - limit;
  return [...lines.slice(0, limit), `… (${rest} more lines)`].join('\n');
}

/**
 * Strip query and hash from a route so nothing secret-ish is attached.
 * @param {string} route
 */
function pathOnly(route) {
  return route.split(/[?#]/)[0] || '/';
}

/**
 * Collect the context attached to a report. Every field can be injected (for
 * tests and for callers that already know the route); the defaults read the
 * browser globals when present.
 *
 * @param {{
 *   error?: unknown,
 *   route?: string,
 *   origin?: string,
 *   appName?: string,
 *   version?: string,
 *   userAgent?: string
 * }} input
 * @returns {IssueReportContext}
 */
export function collectReportContext(input = {}) {
  const hasWindow = typeof window !== 'undefined';
  const loc = hasWindow ? window.location : undefined;
  const route = input.route ?? (loc ? loc.pathname : '/');
  const origin = input.origin ?? (loc ? loc.origin : undefined);
  const userAgent =
    input.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const version = input.version ?? getAppVersion();
  const { error } = input;

  let errorMessage = '';
  let errorStack = '';
  if (error instanceof Error) {
    errorMessage = error.message;
    errorStack = trimStack(error.stack);
  } else if (error !== undefined && error !== null) {
    errorMessage = String(error);
  }

  return {
    route: pathOnly(route),
    origin,
    appName: input.appName,
    version,
    userAgent,
    errorMessage,
    errorStack
  };
}

/**
 * Render the context as the trailing markdown section of the issue body.
 * @param {IssueReportContext} context
 */
export function formatContextSection(context) {
  const lines = [];
  lines.push(`- Route: \`${context.route || '/'}\``);
  const app = [context.appName, context.version].filter(Boolean).join(' ');
  if (app) lines.push(`- App: ${app}${context.origin ? ` (${context.origin})` : ''}`);
  else if (context.origin) lines.push(`- Origin: ${context.origin}`);
  if (context.userAgent) lines.push(`- User agent: ${context.userAgent}`);

  let out = lines.join('\n');
  if (context.errorMessage) {
    out += `\n\n**Error:** ${context.errorMessage}`;
    if (context.errorStack) out += `\n\n\`\`\`\n${context.errorStack}\n\`\`\``;
  }
  return out;
}

/**
 * Compose the markdown body: the user's text, then a `---` separated context
 * section (only the allow-listed fields of `context` are read).
 * @param {{ description: string, context: IssueReportContext }} input
 */
export function formatIssueContent({ description, context }) {
  const body = (description || '').trim();
  return `${body}\n\n---\n${formatContextSection(context)}`;
}

/**
 * Build the unsigned kind 1621 template.
 * @param {{ subject: string, description: string, type: IssueReportType, context: IssueReportContext }} input
 * @returns {{ kind: 1621, content: string, tags: string[][] }}
 */
export function buildIssueTemplate({ subject, description, type, context }) {
  const cleanSubject = (subject || '').trim();
  if (!cleanSubject) throw new Error('Issue subject must not be empty');
  const hint = ISSUE_REPORT_REPO.relays[0];
  /** @type {string[][]} */
  const tags = [
    ['a', ISSUE_REPORT_REPO.coordinate, hint],
    ...ISSUE_REPORT_REPO.maintainers.map((p) => ['p', p, hint]),
    ['subject', cleanSubject],
    ['t', TYPE_LABELS[type] ?? TYPE_LABELS.bug],
    ['t', IN_APP_REPORT_LABEL]
  ];
  return { kind: 1621, content: formatIssueContent({ description, context }), tags };
}

/**
 * gitworkshop.dev link for a filed issue.
 * @param {{ id: string, pubkey: string }} event
 */
export function issueGitworkshopUrl(event) {
  const nevent = nip19.neventEncode({
    id: event.id,
    author: event.pubkey,
    relays: [ISSUE_REPORT_REPO.relays[0]]
  });
  return `https://gitworkshop.dev/${nevent}`;
}
