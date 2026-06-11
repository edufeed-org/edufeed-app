/**
 * Side-effect-only shim: install `Promise.try` if missing.
 *
 * `unpdf` bundles a pdf.js build that eagerly calls `Promise.try` during
 * top-level module evaluation. Some Node 22.x runtimes do not yet ship
 * `Promise.try` (added in Node 22.10), which crashes the module load.
 *
 * Import this module *before* `unpdf` so the polyfill is in place when
 * pdf.js evaluates. ES modules evaluate imports in declaration order, so
 * this works as long as the import for this file precedes the unpdf import.
 */
if (typeof Promise.try !== 'function') {
  /** @param {(...args: any[]) => any} fn */
  Promise.try = function (fn, ...args) {
    return new Promise((resolve) => resolve(fn(...args)));
  };
}
