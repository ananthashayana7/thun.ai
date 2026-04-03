import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import LocalStorage from './LocalStorage';
import ErrorTracker from './ErrorTracker';
import { API } from '../utils/constants';

// For production, always use TLS pinning to prevent MITM attacks.
const TLS_CERT_PINS = {
  // SHA-256 fingerprint of the expected server leaf certificate
  'api.thun.ai': ['sha256/PLACEHOLDER_CERT_PIN_1', 'sha256/PLACEHOLDER_CERT_PIN_2'],
};


function isConnectedState(state) {
  return Boolean(state?.isConnected) && state?.isInternetReachable !== false;
}

function isOfflineError(error) {
  return error?.code === 'ERR_NETWORK' || /network error/i.test(error?.message || '');
}

function toBackoffDelay(attemptCount) {
  const baseDelayMs = 30_000;
  const cappedDelayMs = 5 * 60_000;
  return Math.min(cappedDelayMs, baseDelayMs * Math.max(1, attemptCount));
}

function serializeError(error) {
  return error?.response?.data?.error || error?.message || 'Unknown sync error';
}

class SyncService {
  constructor() {
    this._isInitialized = false;
    this._isConnected = true;
    this._isFlushing = false;
    this._listeners = new Map();
    this._unsubscribeNetInfo = null;
  }

  async init() {
    if (this._isInitialized) return;

    const currentState = await NetInfo.fetch();
    this._isConnected = isConnectedState(currentState);

    this._unsubscribeNetInfo = NetInfo.addEventListener((nextState) => {
      const wasConnected = this._isConnected;
      this._isConnected = isConnectedState(nextState);

      if (!wasConnected && this._isConnected) {
        this.flushPending().catch((error) => {
          console.warn('[SyncService] flushPending failed:', error?.message || error);
        });
      }
    });

    this._isInitialized = true;
  }

  subscribe(requestKey, listener) {
    if (!this._listeners.has(requestKey)) {
      this._listeners.set(requestKey, new Set());
    }

    this._listeners.get(requestKey).add(listener);

    return () => {
      const listeners = this._listeners.get(requestKey);
      if (!listeners) return;

      listeners.delete(listener);
      if (listeners.size === 0) {
        this._listeners.delete(requestKey);
      }
    };
  }

  async getCachedResult(requestKey) {
    await this.init();
    return LocalStorage.getLatestCompletedSyncResult(requestKey);
  }

  async request(options) {
    await this.init();

    const {
      requestKey,
      method = 'POST',
      url,
      body = null,
      headers = {},
      timeout = API.TIMEOUT_MS,
      cacheOnSuccess = false,
      queueIfOffline = false,
      dedupeCompleted = false,
      transformResponse = (response) => response.data,
    } = options;

    if (requestKey && dedupeCompleted) {
      const cached = await this.getCachedResult(requestKey);
      if (cached) {
        return { status: 'success', data: cached.responseData, cached: true };
      }
    }

    if (!this._isConnected && queueIfOffline) {
      return this._queueRequest({ requestKey, method, url, body, headers }, 'Offline - queued for retry');
    }

    try {
      const response = await axios({ method, url, data: body, headers, timeout });
      const data = transformResponse(response);

      if (requestKey && cacheOnSuccess) {
        await LocalStorage.saveSyncRequest({
          requestKey,
          method,
          url,
          body,
          headers,
          status: 'completed',
          responseData: data,
          attemptCount: 0,
          lastError: null,
          nextAttemptAt: new Date().toISOString(),
        });
      }

      this._emit(requestKey, { status: 'completed', data, cached: false });
      return { status: 'success', data, cached: false };
    } catch (error) {
      if (requestKey && queueIfOffline && isOfflineError(error)) {
        return this._queueRequest({ requestKey, method, url, body, headers }, serializeError(error));
      }

      this._emit(requestKey, { status: 'failed', error });
      throw error;
    }
  }

  async flushPending() {
    await this.init();
    if (!this._isConnected || this._isFlushing) return;

    this._isFlushing = true;

    try {
      const pendingRequests = await LocalStorage.getPendingSyncRequests();

      for (const request of pendingRequests) {
        if (!this._isConnected) break;

        await LocalStorage.updateSyncRequestStatus(request.request_key, 'processing', {
          attemptCount: request.attempt_count,
          nextAttemptAt: new Date().toISOString(),
        });

        try {
          const response = await axios({
            method: request.method,
            url: request.url,
            data: request.body,
            headers: request.headers,
            timeout: API.TIMEOUT_MS,
          });

          await LocalStorage.updateSyncRequestStatus(request.request_key, 'completed', {
            responseData: response.data,
            attemptCount: request.attempt_count + 1,
            lastError: null,
            nextAttemptAt: new Date().toISOString(),
          });

          this._emit(request.request_key, { status: 'completed', data: response.data, cached: false });
        } catch (error) {
          if (isOfflineError(error)) {
            this._isConnected = false;
          }

          const attemptCount = request.attempt_count + 1;
          await LocalStorage.updateSyncRequestStatus(request.request_key, 'pending', {
            attemptCount,
            lastError: serializeError(error),
            nextAttemptAt: new Date(Date.now() + toBackoffDelay(attemptCount)).toISOString(),
          });

          this._emit(request.request_key, { status: 'queued', error, attemptCount });

          if (!this._isConnected) {
            break;
          }
        }
      }
    } finally {
      this._isFlushing = false;
    }
  }

  async _queueRequest({ requestKey, method, url, body, headers }, lastError) {
    await LocalStorage.saveSyncRequest({
      requestKey,
      method,
      url,
      body,
      headers,
      status: 'pending',
      responseData: null,
      attemptCount: 0,
      lastError,
      nextAttemptAt: new Date().toISOString(),
    });

    this._emit(requestKey, { status: 'queued', error: lastError });
    return { status: 'queued' };
  }

  _emit(requestKey, event) {
    if (!requestKey) return;

    const listeners = this._listeners.get(requestKey);
    if (!listeners) return;

    listeners.forEach((listener) => listener(event));
  }
}

export default new SyncService();