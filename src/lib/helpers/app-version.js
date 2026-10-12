/**
 * Build-time app version (package.json `version` plus the short git sha of
 * the build, see scripts/app-version.mjs), injected by the `__APP_VERSION__`
 * define in vite.config.js. Guarded so plain node tests and tools that bypass
 * Vite still work.
 * @returns {string} e.g. "0.6.0+b17b4ce", or "unknown"
 */
export function getAppVersion() {
  try {
    // eslint-disable-next-line no-undef
    return typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'unknown';
  } catch {
    return 'unknown';
  }
}
