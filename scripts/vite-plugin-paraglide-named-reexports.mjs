import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Paraglide's messages/_index.js is one `export * from` per message (~4800).
// Rollup resolves a name through star re-exports by scanning all of them and
// caches every miss: about 3 GB of heap in the client build (heap profile,
// 2026-11-23). Named re-exports resolve directly; the bundle stays the same.
export function paraglideNamedReexports() {
  return {
    name: 'paraglide-named-reexports',
    /** @param {string} code @param {string} id */
    transform(code, id) {
      if (!/\/paraglide\/messages\/_index\.js$/.test(id.split('?')[0])) return null;
      const dir = dirname(id.split('?')[0]);
      return code.replace(
        /^export \* from '(\.\/[^']+)'/gm,
        (/** @type {string} */ line, /** @type {string} */ file) => {
          const src = readFileSync(resolve(dir, file), 'utf8');
          const names = [
            ...[...src.matchAll(/^export const (\w+)/gm)].map((m) => m[1]),
            ...[...src.matchAll(/^export \{ \w+ as ("[^"]+"|\w+) \}/gm)].map((m) => m[1])
          ];
          return names.length ? `export { ${names.join(', ')} } from '${file}'` : line;
        }
      );
    }
  };
}
