import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import LocalStorage from './LocalStorage';
import ErrorTracker from './ErrorTracker';
import AuthSessionService from './AuthSessionService';
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

function isRetryableError(error) {
  if (isOfflineError(error)) {
    return true;
  }

  const status = error?.response?.status;
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function isAuthError(error) {
  const status = error?.response?.status;
  return status === 401 || status === 403;
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
    this._healthListeners = new Set();
    this._unsubscribeNetInfo = null;
    this._appStateSubscription = null;
    this._queueStats = { pending: 0, processing: 0, completed: 0 };
    this._lastFlushAt = null;
    this._lastError = null;
  }

  async init() {
    if (this._isInitialized) return;

    const currentState = await NetInfo.fetch();
    this._isConnected = isConnectedState(currentState);

    this._unsubscribeNetInfo = NetInfo.addEventListener((nextState) => {
      const wasConnected = this._isConnected;
      this._isConnected = isConnectedState(nextState);
      this._emitHealth();

      if (!wasConnected && this._isConnected) {
        this.flushPending().catch((error) => {
          console.warn('[SyncService] flushPending failed:', error?.message || error);
        });
      }
    });

    this._appStateSubscription = AppState.addEventListener?.('change', (nextState) => {
      if (nextState === 'active') {
        this.flushPending().catch((error) => {
          console.warn('[SyncService] foreground flush failed:', error?.message || error);
        });
      }
    });

    await this._refreshQueueStats();
    this._emitHealth();

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

  subscribeHealth(listener) {
    this._healthListeners.add(listener);
    listener(this.getConnectionStatus());

    return () => {
      this._healthListeners.delete(listener);
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

    const requestHeaders = await AuthSessionService.buildAuthHeaders(headers);

    if (requestKey && dedupeCompleted) {
      const cached = await this.getCachedResult(requestKey);
      if (cached) {
        return { status: 'success', data: cached.responseData, cached: true };
      }
    }

    if (!this._isConnected && queueIfOffline) {
      return this._queueRequest({ requestKey, method, url, body, headers: requestHeaders }, 'Offline - queued for retry');
    }

    try {
      const response = await axios({ method, url, data: body, headers: requestHeaders, timeout });
      const data = transformResponse(response);

      if (requestKey && cacheOnSuccess) {
        await LocalStorage.saveSyncRequest({
          requestKey,
          method,
          url,
          body,
          headers: requestHeaders,
          status: 'completed',
          responseData: data,
          attemptCount: 0,
          lastError: null,
          nextAttemptAt: new Date().toISOString(),
        });
      }

      this._lastError = null;
      await this._refreshQueueStats();
      this._emit(requestKey, { status: 'completed', data, cached: false });
      this._emitHealth();
      return { status: 'success', data, cached: false };
    } catch (error) {
      if (requestKey && queueIfOffline && isRetryableError(error)) {
        return this._queueRequest({ requestKey, method, url, body, headers: requestHeaders }, serializeError(error));
      }

      this._lastError = isAuthError(error)
        ? 'Authentication required. Provision a backend token before syncing protected APIs.'
        : serializeError(error);
      ErrorTracker.captureError(error, {
        requestKey,
        url,
        service: 'sync.request',
      });
      this._emit(requestKey, { status: 'failed', error });
      this._emitHealth();
      throw error;
    }
  }

  async flushPending() {
    await this.init();
    if (!this._isConnected || this._isFlushing) return;

    this._isFlushing = true;
    this._emitHealth();

    try {
      const pendingRequests = await LocalStorage.getPendingSyncRequests();
      this._queueStats.pending = pendingRequests.length;

      for (const request of pendingRequests) {
        if (!this._isConnected) break;

        await LocalStorage.updateSyncRequestStatus(request.request_key, 'processing', {
          attemptCount: request.attempt_count,
          nextAttemptAt: new Date().toISOString(),
        });

        try {
          const requestHeaders = await AuthSessionService.buildAuthHeaders(request.headers || {});
          const response = await axios({
            method: request.method,
            url: request.url,
            data: request.body,
            headers: requestHeaders,
            timeout: API.TIMEOUT_MS,
          });

          await LocalStorage.updateSyncRequestStatus(request.request_key, 'completed', {
            responseData: response.data,
            attemptCount: request.attempt_count + 1,
            lastError: null,
            nextAttemptAt: new Date().toISOString(),
          });

          this._lastError = null;
          this._lastFlushAt = new Date().toISOString();
          this._emit(request.request_key, { status: 'completed', data: response.data, cached: false });
        } catch (error) {
          if (isOfflineError(error)) {
            this._isConnected = false;
          }

          const attemptCount = request.attempt_count + 1;
          const retryable = isRetryableError(error);
          const errorMessage = isAuthError(error)
            ? 'Authentication required. Provision a backend token before syncing protected APIs.'
            : serializeError(error);

          await LocalStorage.updateSyncRequestStatus(
            request.request_key,
            retryable ? 'pending' : 'failed',
            {
              attemptCount,
              lastError: errorMessage,
              nextAttemptAt: retryable
                ? new Date(Date.now() + toBackoffDelay(attemptCount)).toISOString()
                : new Date().toISOString(),
            }
          );

          this._lastError = errorMessage;
          ErrorTracker.captureError(error, {
            requestKey: request.request_key,
            url: request.url,
            service: 'sync.flushPending',
            attemptCount,
          });
          this._emit(
            request.request_key,
            retryable
              ? { status: 'queued', error, attemptCount }
              : { status: 'failed', error, attemptCount }
          );

          if (!this._isConnected) {
            break;
          }
        }
      }
    } finally {
      await this._refreshQueueStats();
      this._isFlushing = false;
      this._emitHealth();
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

    this._lastError = lastError;
    await this._refreshQueueStats();
    this._emit(requestKey, { status: 'queued', error: lastError });
    this._emitHealth();
    return { status: 'queued' };
  }

  _emit(requestKey, event) {
    if (!requestKey) return;

    const listeners = this._listeners.get(requestKey);
    if (!listeners) return;

    listeners.forEach((listener) => listener(event));
  }

  async _refreshQueueStats() {
    if (typeof LocalStorage.getSyncQueueStats === 'function') {
      this._queueStats = await LocalStorage.getSyncQueueStats();
    }
  }

  _emitHealth() {
    const snapshot = this.getConnectionStatus();
    this._healthListeners.forEach((listener) => listener(snapshot));
  }

  async recoverNow() {
    await this.init();
    await this.flushPending();
  }

  getConnectionStatus() {
    return {
      initialized: this._isInitialized,
      connected: this._isConnected,
      flushing: this._isFlushing,
      activeSubscriptions: this._listeners.size,
      queueStats: this._queueStats,
      queuedRequestCount: this._queueStats.pending + this._queueStats.processing,
      lastFlushAt: this._lastFlushAt,
      lastError: this._lastError,
    };
  }
}

export default new SyncService();
