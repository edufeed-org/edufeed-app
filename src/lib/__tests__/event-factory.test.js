/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** @type {any} */
let mockSetClient;
/** @type {any} */
let mockClearClient;
/** @type {any} */
let MockEventFactory;

vi.mock('applesauce-core/event-factory', () => {
  mockSetClient = vi.fn();
  mockClearClient = vi.fn();
  MockEventFactory = vi.fn().mockImplementation(function () {
    this.setClient = mockSetClient;
    this.clearClient = mockClearClient;
  });
  return { EventFactory: MockEventFactory };
});

const mockAppSettings = { includeClientTag: true };
vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: mockAppSettings
}));

const mockRuntimeConfig = { clientName: 'TestApp' };
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: mockRuntimeConfig
}));

// Import after mocks are set up
const { createAppEventFactory } = await import('$lib/helpers/event-factory.js');

describe('createAppEventFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppSettings.includeClientTag = true;
    mockRuntimeConfig.clientName = 'TestApp';
  });

  it('sets client tag when includeClientTag is true and clientName is set', () => {
    createAppEventFactory();
    expect(mockSetClient).toHaveBeenCalledWith({ name: 'TestApp' });
  });

  it('does not set client tag when includeClientTag is false', () => {
    mockAppSettings.includeClientTag = false;
    createAppEventFactory();
    expect(mockSetClient).not.toHaveBeenCalled();
  });

  it('does not set client tag when clientName is empty', () => {
    mockRuntimeConfig.clientName = '';
    createAppEventFactory();
    expect(mockSetClient).not.toHaveBeenCalled();
  });

  it('passes options through to EventFactory constructor', () => {
    const signer = /** @type {any} */ ({ getPublicKey: vi.fn() });
    createAppEventFactory({ signer });
    expect(MockEventFactory).toHaveBeenCalledWith({ signer });
  });
});
