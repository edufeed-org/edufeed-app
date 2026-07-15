/**
 * App Settings Store
 * Manages application-wide settings with localStorage persistence
 */

import { browser } from '$app/environment';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

const STORAGE_KEY = 'app-settings';
const CONFIG_DEFAULTS_KEY = 'app-settings-config-defaults';

/**
 * Default settings
 * @typedef {Object} AppSettings
 * @property {boolean} debugMode
 * @property {'default' | 'stil' | 'rpi'} themeFamily
 * @property {'light' | 'dark' | 'system'} colorMode
 * @property {boolean} gatedMode
 * @property {boolean} includeClientTag
 * @property {'communities' | 'following' | 'combined' | 'relay'} dashboardFeedSource
 * @property {string} dashboardFeedRelay
 * @property {string[]} dashboardCustomRelays
 * @property {boolean} linkPreviewsEnabled
 */

/**
 * Get stored config defaults from localStorage
 * Used to detect when deployment theme settings have changed
 * @returns {{lightTheme: string, darkTheme: string} | null}
 */
function getStoredConfigDefaults() {
  if (!browser) return null;
  try {
    const stored = localStorage.getItem(CONFIG_DEFAULTS_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

/**
 * Save current config defaults to localStorage
 * @param {string} lightTheme
 * @param {string} darkTheme
 */
function saveConfigDefaults(lightTheme, darkTheme) {
  if (!browser) return;
  try {
    localStorage.setItem(CONFIG_DEFAULTS_KEY, JSON.stringify({ lightTheme, darkTheme }));
  } catch (e) {
    console.error('Failed to save config defaults:', e);
  }
}

/**
 * Map theme name to themeFamily and colorMode
 * @param {'light' | 'dark' | 'stil' | 'stil-dark' | 'rpi' | 'rpi-dark'} theme
 * @returns {{themeFamily: 'default' | 'stil' | 'rpi', colorMode: 'light' | 'dark'}}
 */
function parseThemeToSettings(theme) {
  switch (theme) {
    case 'stil':
      return { themeFamily: 'stil', colorMode: 'light' };
    case 'stil-dark':
      return { themeFamily: 'stil', colorMode: 'dark' };
    case 'rpi':
      return { themeFamily: 'rpi', colorMode: 'light' };
    case 'rpi-dark':
      return { themeFamily: 'rpi', colorMode: 'dark' };
    case 'dark':
      return { themeFamily: 'default', colorMode: 'dark' };
    case 'light':
    default:
      return { themeFamily: 'default', colorMode: 'light' };
  }
}

/**
 * Get default settings (uses runtime config)
 * @returns {AppSettings}
 */
function getDefaultSettings() {
  // Color mode is fixed to light — dark themes are retired for now, so the
  // OS preference and THEME_DEFAULT_DARK are intentionally ignored.
  const defaultTheme = /** @type {'light' | 'dark' | 'stil' | 'stil-dark'} */ (
    runtimeConfig.ui?.defaultLightTheme || 'light'
  );

  const { themeFamily } = parseThemeToSettings(defaultTheme);

  return {
    debugMode: false,
    themeFamily,
    colorMode: 'light',
    gatedMode: runtimeConfig.gatedMode?.default ?? false,
    includeClientTag: true,
    dashboardFeedSource: 'communities',
    dashboardFeedRelay: '',
    dashboardCustomRelays: [],
    linkPreviewsEnabled: true
  };
}

/**
 * Migrate old theme format to new themeFamily + colorMode format
 * @param {any} stored - Stored settings object
 * @returns {AppSettings}
 */
function migrateSettings(stored) {
  const defaults = getDefaultSettings();

  // If new format already exists, use it
  if (stored.themeFamily !== undefined && stored.colorMode !== undefined) {
    return {
      debugMode: stored.debugMode ?? defaults.debugMode,
      themeFamily: stored.themeFamily ?? defaults.themeFamily,
      colorMode: stored.colorMode ?? defaults.colorMode,
      gatedMode: stored.gatedMode ?? defaults.gatedMode,
      includeClientTag: stored.includeClientTag ?? defaults.includeClientTag,
      dashboardFeedSource: stored.dashboardFeedSource ?? defaults.dashboardFeedSource,
      dashboardFeedRelay: stored.dashboardFeedRelay ?? defaults.dashboardFeedRelay,
      dashboardCustomRelays: Array.isArray(stored.dashboardCustomRelays)
        ? stored.dashboardCustomRelays
        : defaults.dashboardCustomRelays,
      linkPreviewsEnabled: stored.linkPreviewsEnabled ?? defaults.linkPreviewsEnabled
    };
  }

  // Migrate old 'theme' format to new format
  const oldTheme = stored.theme;
  let themeFamily = defaults.themeFamily;
  let colorMode = defaults.colorMode;

  if (oldTheme === 'system') {
    themeFamily = 'default';
    colorMode = 'system';
  } else if (oldTheme === 'light') {
    themeFamily = 'default';
    colorMode = 'light';
  } else if (oldTheme === 'dark') {
    themeFamily = 'default';
    colorMode = 'dark';
  } else if (oldTheme === 'stil') {
    themeFamily = 'stil';
    colorMode = 'light';
  } else if (oldTheme === 'stil-dark') {
    themeFamily = 'stil';
    colorMode = 'dark';
  } else if (oldTheme === 'rpi') {
    themeFamily = 'rpi';
    colorMode = 'light';
  } else if (oldTheme === 'rpi-dark') {
    themeFamily = 'rpi';
    colorMode = 'dark';
  }

  return {
    debugMode: stored.debugMode ?? defaults.debugMode,
    themeFamily,
    colorMode,
    gatedMode: stored.gatedMode ?? defaults.gatedMode,
    includeClientTag: stored.includeClientTag ?? defaults.includeClientTag,
    dashboardFeedSource: stored.dashboardFeedSource ?? defaults.dashboardFeedSource,
    dashboardFeedRelay: stored.dashboardFeedRelay ?? defaults.dashboardFeedRelay,
    dashboardCustomRelays: Array.isArray(stored.dashboardCustomRelays)
      ? stored.dashboardCustomRelays
      : defaults.dashboardCustomRelays,
    linkPreviewsEnabled: stored.linkPreviewsEnabled ?? defaults.linkPreviewsEnabled
  };
}

/**
 * Load settings from localStorage
 * @returns {AppSettings}
 */
function loadSettings() {
  const defaults = getDefaultSettings();
  if (!browser) return defaults;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return migrateSettings(parsed);
    }
  } catch (e) {
    console.error('Failed to load app settings:', e);
  }
  return defaults;
}

/**
 * Save settings to localStorage
 * @param {AppSettings} settings
 */
function saveSettings(settings) {
  if (!browser) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save app settings:', e);
  }
}

// Reactive settings state
let settings = $state(loadSettings());

/**
 * Track if app settings have been initialized to prevent re-initialization
 */
let initialized = false;

/**
 * Initialize app settings with runtime config
 * Called from the layout after runtime config is loaded
 * Handles both new users and detecting when deployment defaults change
 */
export function initializeAppSettings() {
  if (!browser || initialized) return;
  initialized = true; // Mark as initialized BEFORE modifying state

  // Get current runtime config theme defaults
  const currentLightTheme = runtimeConfig.ui?.defaultLightTheme || 'light';
  const currentDarkTheme = runtimeConfig.ui?.defaultDarkTheme || 'dark';

  // Check what config defaults were last time
  const storedConfigDefaults = getStoredConfigDefaults();

  // Check if user has saved preferences
  const stored = localStorage.getItem(STORAGE_KEY);

  if (!stored) {
    // New user - apply runtime config defaults
    const defaults = getDefaultSettings();
    settings = defaults;
    saveSettings(settings);
    saveConfigDefaults(currentLightTheme, currentDarkTheme);
    return;
  }

  // Existing user - check if deployment theme defaults have changed
  const configChanged =
    storedConfigDefaults &&
    (storedConfigDefaults.lightTheme !== currentLightTheme ||
      storedConfigDefaults.darkTheme !== currentDarkTheme);

  if (configChanged && settings.colorMode === 'system') {
    // Config defaults changed and user is on system mode - update theme family
    // Users who manually chose light/dark keep their preference
    const { themeFamily } = parseThemeToSettings(
      /** @type {'light' | 'dark' | 'stil' | 'stil-dark'} */ (currentLightTheme)
    );
    settings.themeFamily = themeFamily;
    saveSettings(settings);
  }

  // Always save current config defaults for future comparison
  saveConfigDefaults(currentLightTheme, currentDarkTheme);
}

/**
 * Compute effective theme reactively.
 * Color mode is fixed to light — dark themes are retired for now, so only the
 * theme family matters. A persisted colorMode of 'dark'/'system' is inert.
 *
 * IMPORTANT: This logic is mirrored in src/app.html (inline script) to avoid
 * theme flash on initial load. Keep both in sync when adding/removing theme families.
 *
 * @type {'light' | 'stil' | 'rpi'}
 */
let effectiveTheme = $derived(
  settings.themeFamily === 'stil' ? 'stil' : settings.themeFamily === 'rpi' ? 'rpi' : 'light'
);

/**
 * App settings store with reactive getters and setters
 */
export const appSettings = {
  /**
   * Get debug mode status
   */
  get debugMode() {
    return settings.debugMode;
  },

  /**
   * Set debug mode status
   * @param {boolean} value
   */
  set debugMode(value) {
    settings.debugMode = value;
    saveSettings(settings);
  },

  /**
   * Toggle debug mode
   */
  toggleDebugMode() {
    this.debugMode = !this.debugMode;
  },

  /**
   * Get theme family preference
   * @returns {'default' | 'stil' | 'rpi'}
   */
  get themeFamily() {
    return settings.themeFamily;
  },

  /**
   * Set theme family preference
   * @param {'default' | 'stil' | 'rpi'} value
   */
  set themeFamily(value) {
    settings.themeFamily = /** @type {'default' | 'stil' | 'rpi'} */ (value);
    saveSettings(settings);
  },

  /**
   * Get color mode preference
   * @returns {'light' | 'dark' | 'system'}
   */
  get colorMode() {
    return settings.colorMode;
  },

  /**
   * Set color mode preference
   * @param {'light' | 'dark' | 'system'} value
   */
  set colorMode(value) {
    settings.colorMode = /** @type {'light' | 'dark' | 'system'} */ (value);
    saveSettings(settings);
  },

  /**
   * Get effective theme (resolves family + mode to actual theme)
   * @returns {'light' | 'dark' | 'stil' | 'stil-dark' | 'rpi' | 'rpi-dark'}
   */
  get effectiveTheme() {
    return effectiveTheme;
  },

  /**
   * Get gated mode status
   * Returns forced value if GATED_MODE_FORCE is true, otherwise user preference
   * @returns {boolean}
   */
  get gatedMode() {
    // If force is enabled, always return true regardless of user preference
    if (runtimeConfig.gatedMode?.force) {
      return true;
    }
    return settings.gatedMode;
  },

  /**
   * Set gated mode status
   * No-op if GATED_MODE_FORCE is true
   * @param {boolean} value
   */
  set gatedMode(value) {
    // Don't allow changes if force mode is enabled
    if (runtimeConfig.gatedMode?.force) {
      return;
    }
    settings.gatedMode = value;
    saveSettings(settings);
  },

  /**
   * Check if gated mode can be toggled by user
   * @returns {boolean}
   */
  get canToggleGatedMode() {
    return !runtimeConfig.gatedMode?.force;
  },

  /**
   * Get includeClientTag setting
   * @returns {boolean}
   */
  get includeClientTag() {
    return settings.includeClientTag;
  },

  /**
   * Set includeClientTag setting
   * @param {boolean} value
   */
  set includeClientTag(value) {
    settings.includeClientTag = value;
    saveSettings(settings);
  },

  /**
   * Get dashboard feed source
   * @returns {'communities' | 'following' | 'combined' | 'relay'}
   */
  get dashboardFeedSource() {
    return settings.dashboardFeedSource;
  },

  /**
   * Set dashboard feed source
   * @param {'communities' | 'following' | 'combined' | 'relay'} value
   */
  set dashboardFeedSource(value) {
    settings.dashboardFeedSource = value;
    saveSettings(settings);
  },

  /**
   * Get the relay URL for the relay-based dashboard feed
   * @returns {string}
   */
  get dashboardFeedRelay() {
    return settings.dashboardFeedRelay;
  },

  /**
   * Set the relay URL for the relay-based dashboard feed
   * @param {string} value
   */
  set dashboardFeedRelay(value) {
    settings.dashboardFeedRelay = value;
    saveSettings(settings);
  },

  /**
   * Get user-added custom feed relays
   * @returns {string[]}
   */
  get dashboardCustomRelays() {
    return settings.dashboardCustomRelays;
  },

  /**
   * Replace the user-added custom feed relays (always assign a new array)
   * @param {string[]} value
   */
  set dashboardCustomRelays(value) {
    settings.dashboardCustomRelays = value;
    saveSettings(settings);
  },

  /**
   * Get link previews enabled
   * @returns {boolean}
   */
  get linkPreviewsEnabled() {
    return settings.linkPreviewsEnabled;
  },

  /**
   * Set link previews enabled
   * @param {boolean} value
   */
  set linkPreviewsEnabled(value) {
    settings.linkPreviewsEnabled = value;
    saveSettings(settings);
  },

  /**
   * Toggle gated mode
   * Reloads page to ensure all subscriptions use the new relay configuration
   */
  toggleGatedMode() {
    this.gatedMode = !this.gatedMode;
    // Reload page to kill active subscriptions and refetch with new relay set
    if (browser) {
      window.location.reload();
    }
  }
};
