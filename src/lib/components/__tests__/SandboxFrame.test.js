// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import SandboxFrame from '../../webxdc/SandboxFrame.svelte';

describe('SandboxFrame', () => {
  const props = {
    id: 'abc123label',
    files: new Map([['index.html', new TextEncoder().encode('<html></html>')]]),
    bridgeScript: 'window.webxdc = {};',
    onRpc: async () => null
  };

  it('renders an iframe on the configured sandbox domain', () => {
    const { container } = render(SandboxFrame, { props });
    const iframe = container.querySelector('iframe');
    expect(iframe.src).toBe('https://abc123label.iframe.diy/');
  });

  it('applies the sandbox attribute without allow-top-navigation', () => {
    const { container } = render(SandboxFrame, { props });
    const sandbox = container.querySelector('iframe').getAttribute('sandbox');
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-top-navigation');
  });
});
