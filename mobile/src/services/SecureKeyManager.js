/**
 * SecureKeyManager.js
 * Resolves the SQLCipher database key from the native secure runtime.
 *
 * Production builds fail closed if the native keystore bridge is unavailable.
 * Development builds fall back to a persisted local-only key so contributors
 * can run the app without provisioning hardware security.
 */
import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_RUNTIME } from '../utils/constants';

const DEV_DB_KEY_STORAGE_KEY = '@thunai/dev-database-key';
const SECURE_RUNTIME_MODULE = NativeModules.ThunSecureRuntime;

function createDevelopmentKey() {
  const randomChunk = Math.random().toString(36).slice(2);
  return `dev-sqlcipher-${Date.now()}-${randomChunk}`;
}

class SecureKeyManager {
  constructor() {
    this._cachedKey = null;
  }

  async getDatabaseKey(alias = APP_RUNTIME.SECURE_STORAGE_ALIAS) {
    if (this._cachedKey) {
      return this._cachedKey;
    }

    if (Platform.OS === 'android' && SECURE_RUNTIME_MODULE?.getDatabaseKey) {
      const key = await SECURE_RUNTIME_MODULE.getDatabaseKey(alias);
      this._cachedKey = key;
      return key;
    }

    if (!APP_RUNTIME.SECURE_STORAGE_REQUIRED) {
      const existingKey = await AsyncStorage.getItem(DEV_DB_KEY_STORAGE_KEY);
      if (existingKey) {
        this._cachedKey = existingKey;
        return existingKey;
      }

      const nextKey = createDevelopmentKey();
      await AsyncStorage.setItem(DEV_DB_KEY_STORAGE_KEY, nextKey);
      this._cachedKey = nextKey;
      return nextKey;
    }

    throw new Error(
      'Secure database key is unavailable. Install the native keystore bridge before running a production build.'
    );
  }

  async getStatus(alias = APP_RUNTIME.SECURE_STORAGE_ALIAS) {
    if (Platform.OS === 'android' && SECURE_RUNTIME_MODULE?.getRuntimeStatus) {
      return SECURE_RUNTIME_MODULE.getRuntimeStatus(alias);
    }

    return {
      secureStorageRequired: APP_RUNTIME.SECURE_STORAGE_REQUIRED,
      nativeModuleAvailable: Boolean(SECURE_RUNTIME_MODULE),
      platform: Platform.OS,
      mode: APP_RUNTIME.ENVIRONMENT,
      keystoreBacked: false,
      usingDevelopmentFallback: !APP_RUNTIME.SECURE_STORAGE_REQUIRED,
    };
  }

  async clearDevelopmentKey() {
    this._cachedKey = null;
    if (!APP_RUNTIME.SECURE_STORAGE_REQUIRED) {
      await AsyncStorage.removeItem(DEV_DB_KEY_STORAGE_KEY);
    }
  }
}

export default new SecureKeyManager();
