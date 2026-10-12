/** @vitest-environment node */
/**
 * app-version.mjs — the build's version name (`kit.version.name` and
 * `__APP_VERSION__`): package version plus a short commit sha, deterministic
 * per build so SvelteKit's update detection only fires on a real new deploy.
 */
import { describe, it, expect } from 'vitest';
import { resolveAppVersion, shortSha } from './app-version.mjs';

const FULL = 'b17b4cec0123456789abcdef0123456789abcdef';

describe('shortSha', () => {
  it('cuts a full sha to 7 lowercase chars', () => {
    expect(shortSha(FULL)).toBe('b17b4ce');
    expect(shortSha(' B17B4CEC ')).toBe('b17b4ce');
  });

  it('rejects anything that is not a sha', () => {
    expect(shortSha('')).toBe('');
    expect(shortSha(undefined)).toBe('');
    expect(shortSha('main')).toBe('');
    expect(shortSha('abc')).toBe('');
  });
});

describe('resolveAppVersion', () => {
  it('prefers the GIT_SHA env (the CI build arg) over the git checkout', () => {
    const version = resolveAppVersion({
      pkgVersion: '0.6.0',
      env: { GIT_SHA: FULL },
      readGitSha: () => 'deadbeefdeadbeef'
    });
    expect(version).toBe('0.6.0+b17b4ce');
  });

  it('falls back to git rev-parse when GIT_SHA is unset or empty', () => {
    const version = resolveAppVersion({
      pkgVersion: '0.6.0',
      env: { GIT_SHA: '' },
      readGitSha: () => 'deadbeefdeadbeef\n'
    });
    expect(version).toBe('0.6.0+deadbee');
  });

  it('omits the suffix when git is unavailable (no .git in the Docker build)', () => {
    const version = resolveAppVersion({
      pkgVersion: '0.6.0',
      env: {},
      readGitSha: () => {
        throw new Error('fatal: not a git repository');
      }
    });
    expect(version).toBe('0.6.0');
  });

  it('is deterministic for the same inputs', () => {
    const input = { pkgVersion: '0.6.0', env: { GIT_SHA: FULL } };
    expect(resolveAppVersion(input)).toBe(resolveAppVersion(input));
  });
});
