/**
 * Build-time app version (package.json `version`), injected by the
 * `__APP_VERSION__` define in vite.config.js. Guarded so plain node tests and
 * tools that bypass Vite still work.
 * @returns {string} e.g. "0.3.4", or "unknown"
 */
export function getAppVersion() {
  try {
    // eslint-disable-next-line no-undef
    return typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'unknown';
  } catch {
    return 'unknown';
  }
}
