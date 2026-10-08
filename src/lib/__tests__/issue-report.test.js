/**
 * In-app issue reporting — NIP-34 kind 1621 issue builder.
 *
 * The report modal (help menu + RenderErrorCard) files a public issue against
 * laoc's edufeed-app repository announcement. These tests pin the wire format
 * (coordinate, relay hint, maintainers, labels), the auto-attached context,
 * and that nothing beyond route/version/user agent/error ever leaves the app.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  ISSUE_REPORT_REPO,
  trimStack,
  collectReportContext,
  formatIssueContent,
  buildIssueTemplate,
  issueGitworkshopUrl
} from '$lib/helpers/issue-report.js';

const OWNER = '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6';

describe('ISSUE_REPORT_REPO', () => {
  it("targets laoc's edufeed-app announcement on the relays it lists", () => {
    expect(ISSUE_REPORT_REPO.ownerPubkey).toBe(OWNER);
    expect(ISSUE_REPORT_REPO.identifier).toBe('edufeed-app');
    expect(ISSUE_REPORT_REPO.coordinate).toBe(`30617:${OWNER}:edufeed-app`);
    expect(ISSUE_REPORT_REPO.relays).toEqual([
      'wss://relay.ngit.dev',
      'wss://gitnostr.com',
      'wss://ngit.danconwaydev.com',
      'wss://groups.edufeed.org'
    ]);
    expect(ISSUE_REPORT_REPO.maintainers).toContain(OWNER);
    expect(ISSUE_REPORT_REPO.maintainers.every((p) => /^[0-9a-f]{64}$/.test(p))).toBe(true);
  });
});

describe('trimStack', () => {
  it('keeps the first 15 lines and marks the cut', () => {
    const stack = Array.from({ length: 40 }, (_, i) => `    at frame${i} (chunk.js:${i}:1)`).join(
      '\n'
    );
    const trimmed = trimStack(stack);
    const lines = trimmed.split('\n');
    expect(lines).toHaveLength(16);
    expect(lines[0]).toContain('frame0');
    expect(lines[14]).toContain('frame14');
    expect(lines[15]).toBe('… (25 more lines)');
  });

  it('returns short stacks untouched and tolerates missing input', () => {
    expect(trimStack('a\nb')).toBe('a\nb');
    expect(trimStack(undefined)).toBe('');
    expect(trimStack('')).toBe('');
  });

  it('honours a custom limit', () => {
    expect(trimStack('1\n2\n3\n4', 2)).toBe('1\n2\n… (2 more lines)');
  });
});

describe('collectReportContext', () => {
  it('records route, app, version, user agent and the error (message + trimmed stack)', () => {
    const error = new Error('each_key_duplicate');
    error.stack = ['Error: each_key_duplicate', ...Array(30).fill('    at x (y.js:1:1)')].join(
      '\n'
    );
    const ctx = collectReportContext({
      error,
      route: '/discover',
      origin: 'https://dev.edufeed.org',
      appName: 'Edufeed',
      version: '0.3.4',
      userAgent: 'TestUA/1.0'
    });
    expect(ctx).toEqual({
      route: '/discover',
      origin: 'https://dev.edufeed.org',
      appName: 'Edufeed',
      version: '0.3.4',
      userAgent: 'TestUA/1.0',
      errorMessage: 'each_key_duplicate',
      errorStack: expect.stringContaining('… (16 more lines)')
    });
    expect(ctx.errorStack.split('\n')).toHaveLength(16);
  });

  it('works without an error (plain feedback) and stringifies non-Error throws', () => {
    const plain = collectReportContext({ route: '/', version: '1.0.0', userAgent: 'ua' });
    expect(plain.errorMessage).toBe('');
    expect(plain.errorStack).toBe('');

    const thrown = collectReportContext({ error: 'string thrown', route: '/', userAgent: 'ua' });
    expect(thrown.errorMessage).toBe('string thrown');
    expect(thrown.errorStack).toBe('');
  });

  it('drops query string and hash from the route (call-pass codes live in the hash)', () => {
    const ctx = collectReportContext({
      route: '/call/abc?x=1#secret-code',
      userAgent: 'ua'
    });
    expect(ctx.route).toBe('/call/abc');
  });

  it('reads the browser defaults when running in a window', () => {
    const originalWindow = globalThis.window;
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal('window', {
      location: { pathname: '/settings', search: '?a=1', hash: '#h', origin: 'https://x.test' }
    });
    vi.stubGlobal('navigator', { userAgent: 'Browser/9' });
    try {
      const ctx = collectReportContext({});
      expect(ctx.route).toBe('/settings');
      expect(ctx.origin).toBe('https://x.test');
      expect(ctx.userAgent).toBe('Browser/9');
    } finally {
      vi.stubGlobal('window', originalWindow);
      vi.stubGlobal('navigator', originalNavigator);
    }
  });
});

describe('formatIssueContent', () => {
  const context = {
    route: '/discover',
    origin: 'https://dev.edufeed.org',
    appName: 'Edufeed',
    version: '0.3.4',
    userAgent: 'TestUA/1.0',
    errorMessage: 'boom',
    errorStack: 'Error: boom\n    at x (y.js:1:1)'
  };

  it('puts the user text first and the context in a trailing markdown section', () => {
    const content = formatIssueContent({ description: 'It broke when I clicked.', context });
    expect(content.startsWith('It broke when I clicked.')).toBe(true);
    expect(content).toContain('\n\n---\n');
    expect(content).toContain('- Route: `/discover`');
    expect(content).toContain('- App: Edufeed 0.3.4 (https://dev.edufeed.org)');
    expect(content).toContain('- User agent: TestUA/1.0');
    expect(content).toContain('**Error:** boom');
    expect(content).toContain('```\nError: boom\n    at x (y.js:1:1)\n```');
  });

  it('omits the error block and empty fields for plain feedback', () => {
    const content = formatIssueContent({
      description: 'An idea',
      context: { route: '/', userAgent: 'ua', errorMessage: '', errorStack: '' }
    });
    expect(content).not.toContain('Error');
    expect(content).not.toContain('```');
    expect(content).not.toContain('- App:');
    expect(content).toContain('- Route: `/`');
  });
});

describe('buildIssueTemplate', () => {
  const context = {
    route: '/discover',
    version: '0.3.4',
    userAgent: 'ua',
    errorMessage: 'boom',
    errorStack: 'Error: boom'
  };

  it('builds a NIP-34 issue addressed to the repo with maintainers p-tagged', () => {
    const template = buildIssueTemplate({
      subject: 'Page crashes',
      description: 'Steps…',
      type: 'bug',
      context
    });
    expect(template.kind).toBe(1621);
    expect(template.tags).toContainEqual([
      'a',
      `30617:${OWNER}:edufeed-app`,
      'wss://relay.ngit.dev'
    ]);
    expect(template.tags).toContainEqual(['subject', 'Page crashes']);
    for (const maintainer of ISSUE_REPORT_REPO.maintainers) {
      expect(template.tags).toContainEqual(['p', maintainer, 'wss://relay.ngit.dev']);
    }
    expect(template.tags).toContainEqual(['t', 'bug']);
    expect(template.tags).toContainEqual(['t', 'in-app-report']);
    expect(template.content).toContain('Steps…');
    expect(template.content).toContain('- Route: `/discover`');
  });

  it('labels ideas as feature requests', () => {
    const template = buildIssueTemplate({ subject: 'S', description: 'D', type: 'idea', context });
    expect(template.tags).toContainEqual(['t', 'feature']);
    expect(template.tags).not.toContainEqual(['t', 'bug']);
  });

  it('trims the subject and never emits an empty subject tag', () => {
    const template = buildIssueTemplate({
      subject: '  Hi  ',
      description: 'D',
      type: 'bug',
      context
    });
    expect(template.tags).toContainEqual(['subject', 'Hi']);
    expect(() =>
      buildIssueTemplate({ subject: '   ', description: 'D', type: 'bug', context })
    ).toThrow(/subject/i);
  });

  it('carries only the allowed context — no keys, no event content, no account data', () => {
    const template = buildIssueTemplate({
      subject: 'S',
      description: 'D',
      type: 'bug',
      context: /** @type {any} */ ({
        ...context,
        // anything a caller might accidentally stuff in must be ignored
        nsec: 'nsec1secret',
        pubkey: 'deadbeef',
        eventContent: 'private note'
      })
    });
    expect(template.content).not.toContain('nsec1secret');
    expect(template.content).not.toContain('deadbeef');
    expect(template.content).not.toContain('private note');
    expect(JSON.stringify(template.tags)).not.toContain('nsec1secret');
  });
});

describe('issueGitworkshopUrl', () => {
  it('links to gitworkshop.dev with an nevent carrying author and repo relay hints', () => {
    const id = 'ab'.repeat(32);
    const author = 'cd'.repeat(32);
    const url = issueGitworkshopUrl({ id, pubkey: author });
    expect(url.startsWith('https://gitworkshop.dev/nevent1')).toBe(true);
    const decoded = nip19.decode(url.slice('https://gitworkshop.dev/'.length));
    expect(decoded.type).toBe('nevent');
    expect(/** @type {any} */ (decoded.data).id).toBe(id);
    expect(/** @type {any} */ (decoded.data).author).toBe(author);
    expect(/** @type {any} */ (decoded.data).relays).toEqual(['wss://relay.ngit.dev']);
  });
});
