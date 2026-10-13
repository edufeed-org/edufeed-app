/**
 * Build-time app version name shared by svelte.config.js (`kit.version.name`,
 * which SvelteKit's `updated` store compares against the deployed
 * /_app/version.json to detect a new deploy) and vite.config.js
 * (`__APP_VERSION__`, shown in issue reports). Both must agree, and the value
 * must be deterministic per build — SvelteKit would otherwise prompt a reload
 * after every container restart.
 *
 * Shape: `<package.json version>+<short git sha>`, e.g. `0.6.0+b17b4ce`. The
 * sha lets :dev images built between releases (all `0.6.0`) tell each other
 * apart. It comes from the `GIT_SHA` env (CI build arg; the Docker build has
 * no .git), else from `git rev-parse` at config-load time; without either the
 * suffix is omitted.
 */
import { execSync } from 'node:child_process';

export const SHORT_SHA_LENGTH = 7;

/**
 * @param {string | undefined | null} sha full or short commit sha
 * @returns {string} the first 7 hex chars, or '' when the input is not a sha
 */
export function shortSha(sha) {
  const trimmed = (sha ?? '').trim();
  return /^[0-9a-f]{7,40}$/i.test(trimmed) ? trimmed.slice(0, SHORT_SHA_LENGTH).toLowerCase() : '';
}

/**
 * @param {{ pkgVersion: string, env?: NodeJS.ProcessEnv, readGitSha?: () => string }} input
 * @returns {string} e.g. "0.6.0+b17b4ce", or "0.6.0" when no sha is known
 */
export function resolveAppVersion({ pkgVersion, env = process.env, readGitSha = gitHeadSha }) {
  let sha = shortSha(env.GIT_SHA);
  if (!sha) {
    try {
      sha = shortSha(readGitSha());
    } catch {
      sha = '';
    }
  }
  return sha ? `${pkgVersion}+${sha}` : pkgVersion;
}

/** @returns {string} HEAD's sha from the current checkout (throws without git) */
function gitHeadSha() {
  return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
}
