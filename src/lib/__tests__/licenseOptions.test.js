/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  getLicenseOptions,
  STATIC_LICENSE_OPTIONS
} from '$lib/helpers/educational/licenseOptions.js';

describe('getLicenseOptions', () => {
  it('returns the static list when no current url is provided', () => {
    expect(getLicenseOptions()).toEqual(STATIC_LICENSE_OPTIONS);
  });

  it('returns the static list when the current url already matches a static entry', () => {
    const opts = getLicenseOptions('https://creativecommons.org/licenses/by/4.0/');
    expect(opts).toEqual(STATIC_LICENSE_OPTIONS);
  });

  it('appends a synthetic option for an unknown license URL', () => {
    const custom = 'https://creativecommons.org/licenses/by-nc-sa/3.0/de/';
    const opts = getLicenseOptions(custom);
    expect(opts).toHaveLength(STATIC_LICENSE_OPTIONS.length + 1);
    expect(opts[opts.length - 1]).toEqual({ id: custom, label: 'CC BY-NC-SA 3.0 DE' });
  });

  it('exposes the canonical static options', () => {
    expect(STATIC_LICENSE_OPTIONS).toEqual(
      expect.arrayContaining([
        { id: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' },
        { id: 'https://creativecommons.org/licenses/by-sa/4.0/', label: 'CC BY-SA 4.0' },
        { id: 'https://creativecommons.org/licenses/by-nc/4.0/', label: 'CC BY-NC 4.0' },
        { id: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', label: 'CC BY-NC-SA 4.0' },
        { id: 'https://creativecommons.org/publicdomain/zero/1.0/', label: 'CC0 (Public Domain)' },
        { id: 'https://opensource.org/licenses/MIT', label: 'MIT License' }
      ])
    );
  });
});
