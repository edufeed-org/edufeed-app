/** @vitest-environment node */
// The privacy policy is a Markdown file the deployment points at with
// PRIVACY_POLICY_PATH. It is rendered server-side through the same
// allowlist sanitizer as crawler-facing content, and re-read when the file
// changes so an operator can update the text without a rebuild.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @type {string} */
let dir;

/** @param {Record<string, string>} env */
async function policyWith(env) {
  vi.doMock('$env/dynamic/private', () => ({ env }));
  const mod = await import('../server/privacy-policy.js');
  return mod;
}

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), 'privacy-policy-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadPrivacyPolicy', () => {
  it('returns null when no path is configured', async () => {
    const { loadPrivacyPolicy } = await policyWith({});
    expect(await loadPrivacyPolicy()).toBeNull();
  });

  it('returns null when the file is missing', async () => {
    const { loadPrivacyPolicy } = await policyWith({
      PRIVACY_POLICY_PATH: join(dir, 'missing.md')
    });
    expect(await loadPrivacyPolicy()).toBeNull();
  });

  it('renders the Markdown to sanitized HTML and keeps headings, lists and tables', async () => {
    const file = join(dir, 'policy.md');
    writeFileSync(
      file,
      [
        '# Datenschutzerklärung',
        '',
        'Stand: 27. Oktober 2026',
        '',
        '## 1 Verantwortlicher',
        '',
        '- IP-Adresse',
        '',
        '| Dienst | Zweck |',
        '|---|---|',
        '| relay.damus.io | Relay |',
        '',
        '<script>alert(1)</script><img src=x onerror="alert(1)">',
        ''
      ].join('\n')
    );
    const { loadPrivacyPolicy } = await policyWith({ PRIVACY_POLICY_PATH: file });
    const policy = await loadPrivacyPolicy();
    expect(policy).not.toBeNull();
    const html = /** @type {{ html: string }} */ (policy).html;
    expect(html).toContain('<h1');
    expect(html).toContain('Datenschutzerklärung');
    expect(html).toContain('<li>IP-Adresse</li>');
    expect(html).toContain('<table');
    expect(html).toContain('relay.damus.io');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });

  it('re-reads the file when it changes on disk', async () => {
    const file = join(dir, 'policy.md');
    writeFileSync(file, '# Version eins\n');
    const { loadPrivacyPolicy } = await policyWith({ PRIVACY_POLICY_PATH: file });
    expect(/** @type {any} */ (await loadPrivacyPolicy()).html).toContain('Version eins');

    writeFileSync(file, '# Version zwei\n');
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    expect(/** @type {any} */ (await loadPrivacyPolicy()).html).toContain('Version zwei');
  });

  it('resolves a relative path against the working directory', async () => {
    const { resolvePolicyPath } = await policyWith({ PRIVACY_POLICY_PATH: 'legal/x.md' });
    expect(resolvePolicyPath()).toBe(join(process.cwd(), 'legal', 'x.md'));
  });
});
