/**
 * AuthSessionService.js
 * Stores a backend JWT for pilot/device provisioning.
 *
 * The mobile app does not yet implement a full sign-in flow, so production
 * and pilot devices can be provisioned with a backend token during setup.
 * SyncService uses this automatically for protected API calls.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKEND_TOKEN_STORAGE_KEY = '@thunai/backend-token';

function normaliseToken(token) {
  if (!token) return '';
  return String(token).replace(/^Bearer\s+/i, '').trim();
}

class AuthSessionService {
  constructor() {
    this._cachedToken = null;
    this._loadPromise = null;
  }

  async getBackendToken() {
    const envToken = normaliseToken(process.env.THUNAI_BACKEND_TOKEN || process.env.BACKEND_TOKEN || '');
    if (envToken) {
      this._cachedToken = envToken;
      return envToken;
    }

    if (this._cachedToken) {
      return this._cachedToken;
    }

    if (!this._loadPromise) {
      this._loadPromise = AsyncStorage.getItem(BACKEND_TOKEN_STORAGE_KEY)
        .then((token) => {
          this._cachedToken = normaliseToken(token);
          return this._cachedToken;
        })
        .finally(() => {
          this._loadPromise = null;
        });
    }

    return this._loadPromise;
  }

  async setBackendToken(token) {
    const normalised = normaliseToken(token);
    if (!normalised) {
      throw new Error('A backend token is required.');
    }

    await AsyncStorage.setItem(BACKEND_TOKEN_STORAGE_KEY, normalised);
    this._cachedToken = normalised;
    return normalised;
  }

  async clearBackendToken() {
    await AsyncStorage.removeItem(BACKEND_TOKEN_STORAGE_KEY);
    this._cachedToken = null;
  }

  async buildAuthHeaders(headers = {}) {
    if (headers.Authorization || headers.authorization) {
      return headers;
    }

    const token = await this.getBackendToken();
    if (!token) {
      return headers;
    }

    return {
      ...headers,
      Authorization: `Bearer ${token}`,
    };
  }

  async getProvisioningStatus() {
    const envToken = normaliseToken(process.env.THUNAI_BACKEND_TOKEN || process.env.BACKEND_TOKEN || '');
    const persistedToken = await this.getBackendToken();

    return {
      tokenPresent: Boolean(persistedToken),
      provisionedFromEnvironment: Boolean(envToken),
      provisionedFromStorage: Boolean(!envToken && persistedToken),
    };
  }
}

export default new AuthSessionService();
