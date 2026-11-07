/**
 * The deployment's privacy policy (Datenschutzerklärung) as rendered HTML.
 *
 * Operators point `PRIVACY_POLICY_PATH` at a Markdown file (relative paths
 * resolve against the working directory, i.e. `/app` in the Docker image,
 * which ships the edufeed text as `legal/privacy-policy.de.md`). The file is
 * read on demand and re-read whenever its mtime changes, so the text can be
 * swapped by mounting a file — no rebuild. Rendering goes through the same
 * allowlist sanitizer as crawler-facing content: a policy is operator
 * content, but `renderMarkdown`'s own sanitizer is a no-op outside the
 * browser, so nothing is trusted on the way to `{@html}`.
 *
 * Text between `<!-- if:termi -->` and `<!-- endif:termi -->` (inline, or
 * the markers on lines of their own around a block or table row) appears
 * only with TERMI_AI_ENABLED on; off, it is cut together with the markers.
 *
 * Unset path, missing or unreadable file → `null`; `/privacy` then answers
 * 404 and `/api/config` reports `privacy.enabled: false` so the links hide.
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '$env/dynamic/private';
import { renderMarkdown } from '$lib/helpers/markdown.js';
import { sanitizeServerHtml } from '$lib/server/geo/sanitize.js';
import { parseBool } from '$lib/server/env-parse.js';

/** @param {string} markdown @param {boolean} termi */
function applyTermiSections(markdown, termi) {
  return termi
    ? markdown.replace(/<!-- (?:end)?if:termi -->\n?/g, '')
    : // Never across another opening marker: a missing endif leaks its section, never eats the next.
      markdown.replace(
        /<!-- if:termi -->(?:(?!<!-- if:termi -->)[\s\S])*?<!-- endif:termi -->\n?/g,
        ''
      );
}

/** @type {{ path: string, mtimeMs: number, termi: boolean, html: string } | null} */
let cache = null;

/** @returns {string | null} absolute path of the configured policy file */
export function resolvePolicyPath() {
  const configured = (env.PRIVACY_POLICY_PATH || '').trim();
  return configured ? resolve(process.cwd(), configured) : null;
}

/** @returns {Promise<{ html: string } | null>} */
export async function loadPrivacyPolicy() {
  const path = resolvePolicyPath();
  if (!path) return null;

  let info;
  try {
    info = await stat(path);
  } catch {
    return null;
  }
  const termi = parseBool(env.TERMI_AI_ENABLED, false);
  if (cache && cache.path === path && cache.mtimeMs === info.mtimeMs && cache.termi === termi) {
    return { html: cache.html };
  }

  let markdown;
  try {
    markdown = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  const html = sanitizeServerHtml(renderMarkdown(applyTermiSections(markdown, termi)));
  cache = { path, mtimeMs: info.mtimeMs, termi, html };
  return { html };
}
