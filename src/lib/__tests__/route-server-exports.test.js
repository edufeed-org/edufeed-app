/** @vitest-environment node */
/**
 * SvelteKit's production build rejects any export from a `+server.js` file
 * other than the route handlers and options ("Invalid export 'parseArray' in
 * /api/config"). Dev mode and the unit tests never hit that check, so a shared
 * helper exported from a route file only fails in the Docker build — which is
 * how main went red after the Agents page merge. Shared helpers belong in
 * $lib/server.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set([
  'GET',
  'POST',
  'PATCH',
  'PUT',
  'DELETE',
  'OPTIONS',
  'HEAD',
  'fallback',
  'prerender',
  'trailingSlash',
  'config',
  'entries'
]);

/** @param {string} dir @returns {string[]} */
function serverFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverFiles(path);
    return /^\+server\.(js|ts)$/.test(name) ? [path] : [];
  });
}

/** @param {string} source */
function exportedNames(source) {
  const names = [];
  for (const m of source.matchAll(
    /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm
  )) {
    names.push(m[1]);
  }
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe('+server.js route modules', () => {
  const files = serverFiles(join(process.cwd(), 'src/routes'));

  it('finds route modules to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => [f.slice(process.cwd().length + 1), f]))(
    '%s exports only names SvelteKit accepts',
    (_label, file) => {
      const invalid = exportedNames(readFileSync(file, 'utf8')).filter(
        (name) => !ALLOWED.has(name) && !name.startsWith('_')
      );
      expect(invalid).toEqual([]);
    }
  );
});
