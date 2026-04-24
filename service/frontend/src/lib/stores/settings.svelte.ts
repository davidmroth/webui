import { browser } from '$app/environment';
import { CONFIG_LOCALSTORAGE_KEY, SETTING_CONFIG_DEFAULT } from '$lib/constants';
import type { SettingsConfigType, SettingsConfigValue } from '$lib/types';
import { setConfigValue } from '$lib/utils/config-helpers';

function cloneDefaultConfig(): SettingsConfigType {
  return { ...SETTING_CONFIG_DEFAULT } as SettingsConfigType;
}

function normalizeStoredConfig(value: unknown): Partial<SettingsConfigType> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Partial<SettingsConfigType>;
}

function loadStoredConfig(): SettingsConfigType {
  if (!browser) {
    return cloneDefaultConfig();
  }

  try {
    const raw = window.localStorage.getItem(CONFIG_LOCALSTORAGE_KEY);
    if (!raw) {
      return cloneDefaultConfig();
    }

    const parsed = normalizeStoredConfig(JSON.parse(raw));
    return {
      ...cloneDefaultConfig(),
      ...parsed
    };
  } catch {
    return cloneDefaultConfig();
  }
}

let initialized = false;
let currentConfig = $state<SettingsConfigType>(cloneDefaultConfig());

function ensureInitialized() {
  if (initialized) {
    return;
  }

  currentConfig = loadStoredConfig();
  initialized = true;
}

function persistConfig() {
  if (!browser) {
    return;
  }

  try {
    window.localStorage.setItem(CONFIG_LOCALSTORAGE_KEY, JSON.stringify(currentConfig));
  } catch {
    // Ignore storage quota/private-mode failures.
  }
}

export function config(): SettingsConfigType {
  ensureInitialized();
  return currentConfig;
}

export const settingsStore = {
  get config(): SettingsConfigType {
    return config();
  },
  updateConfig(key: string, value: SettingsConfigValue) {
    ensureInitialized();
    setConfigValue(currentConfig, key, value);
    persistConfig();
  },
  replace(nextConfig: Partial<SettingsConfigType>) {
    ensureInitialized();
    currentConfig = {
      ...cloneDefaultConfig(),
      ...normalizeStoredConfig(nextConfig)
    };
    persistConfig();
  },
  reset() {
    currentConfig = cloneDefaultConfig();
    initialized = true;
    persistConfig();
  }
};