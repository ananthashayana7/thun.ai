/**
 * WatchService.js
 * Connects to a Bluetooth LE smartwatch / heart-rate monitor and streams HR/HRV.
 * Uses the Bluetooth GATT Heart Rate Service (UUID 0x180D).
 * Falls back to polling if continuous notifications unavailable.
 */
import { BleManager } from 'react-native-ble-plx';
import { BIOMETRIC } from '../utils/constants';

// Standard BLE Heart Rate Service
const HR_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb';
const HR_CHARACTERISTIC_UUID = '00002a37-0000-1000-8000-00805f9b34fb';

const HRV_WINDOW_SIZE = 10; // R-R intervals to compute RMSSD
const MAX_RECONNECT_DELAY_MS = 30000;

// BleManager must be instantiated (not used statically) per react-native-ble-plx API.
const manager = new BleManager();

class WatchService {
  constructor() {
    this._device = null;
    this._deviceId = null;
    this._subscription = null;
    this._rrIntervals = [];
    this._listeners = [];
    this._connectionListeners = [];
    this._currentHR = null;
    this._currentHRV = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._isConnected = false;
    this._isReconnecting = false;
    this._manualDisconnect = false;
  }

  async scan(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const found = [];
      const timer = setTimeout(() => {
        manager.stopDeviceScan();
        resolve(found);
      }, timeoutMs);

      manager.startDeviceScan([HR_SERVICE_UUID], null, (error, device) => {
        if (error) {
          clearTimeout(timer);
          manager.stopDeviceScan();
          reject(error);
          return;
        }
        if (device && !found.find((d) => d.id === device.id)) {
          found.push({ id: device.id, name: device.name || 'Unknown' });
        }
      });
    });
  }

  async connect(deviceId) {
    try {
      this._manualDisconnect = false;
      this._deviceId = deviceId;
      this._device = await manager.connectToDevice(deviceId);
      await this._device.discoverAllServicesAndCharacteristics();
      this._reconnectAttempts = 0;
      this._isConnected = true;
      this._isReconnecting = false;
      this._emitConnectionState('connected');
      return true;
    } catch (err) {
      console.error('[WatchService] connect error:', err);
      this._isConnected = false;
      this._emitConnectionState('disconnected', err);
      return false;
    }
  }

  startStreaming(onBiometrics) {
    if (!this._device) {
      console.warn('[WatchService] startStreaming without connection');
      return;
    }
    if (typeof onBiometrics === 'function' && !this._listeners.includes(onBiometrics)) {
      this._listeners.push(onBiometrics);
    }

    if (this._subscription) return;
    this._subscription = this._device.monitorCharacteristicForService(
      HR_SERVICE_UUID,
      HR_CHARACTERISTIC_UUID,
      (error, characteristic) => {
        if (error) {
          console.error('[WatchService] BLE notify error:', error);
          this._scheduleReconnect(error);
          return;
        }
        const data = this._parseHRMeasurement(characteristic.value);
        if (!data) return;

        // Accumulate R-R intervals for HRV calculation
        if (data.rrIntervals?.length) {
          this._rrIntervals.push(...data.rrIntervals);
          if (this._rrIntervals.length > HRV_WINDOW_SIZE * 2) {
            this._rrIntervals = this._rrIntervals.slice(-HRV_WINDOW_SIZE * 2);
          }
        }

        const hrv = this._computeRMSSD(this._rrIntervals.slice(-HRV_WINDOW_SIZE));
        this._currentHR = data.heartRate;
        this._currentHRV = hrv;

        const biometrics = {
          hr: data.heartRate,
          hrv,
          timestamp: Date.now(),
        };
        this._listeners.forEach((cb) => cb(biometrics));
      }
    );
  }

  stopStreaming({ preserveListeners = false } = {}) {
    if (this._subscription) {
      this._subscription.remove();
      this._subscription = null;
    }
    if (!preserveListeners) {
      this._listeners = [];
    }
  }

  async disconnect() {
    this._manualDisconnect = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this.stopStreaming();
    if (this._device) {
      await this._device.cancelConnection();
      this._device = null;
    }
    this._isConnected = false;
    this._isReconnecting = false;
    this._emitConnectionState('disconnected');
  }

  _scheduleReconnect(error) {
    if (this._manualDisconnect || this._isReconnecting || !this._deviceId) {
      return;
    }

    this._isConnected = false;
    this._isReconnecting = true;
    this.stopStreaming({ preserveListeners: true });

    if (this._device) {
      this._device.cancelConnection().catch(() => {});
      this._device = null;
    }

    const delay = Math.min(1000 * (2 ** this._reconnectAttempts), MAX_RECONNECT_DELAY_MS);
    this._reconnectAttempts += 1;
    this._emitConnectionState('reconnecting', error, { delay });

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      const reconnected = await this.connect(this._deviceId);
      if (reconnected) {
        this.startStreaming();
      } else {
        this._isReconnecting = false;
        this._scheduleReconnect(error);
      }
    }, delay);
  }

  _emitConnectionState(state, error = null, meta = {}) {
    const payload = {
      state,
      connected: state === 'connected',
      reconnectAttempts: this._reconnectAttempts,
      error: error ? error.message : null,
      ...meta,
    };
    this._connectionListeners.forEach((cb) => cb(payload));
  }

  onConnectionChange(cb) {
    this._connectionListeners.push(cb);
    return () => {
      this._connectionListeners = this._connectionListeners.filter((listener) => listener !== cb);
    };
  }

  /** Decode BLE Heart Rate Measurement characteristic (0x2A37) */
  _parseHRMeasurement(base64Value) {
    try {
      const bytes = Buffer.from(base64Value, 'base64');
      const flags = bytes[0];
      const hrFormat16bit = (flags & 0x01) !== 0;

      let offset = 1;
      let heartRate;
      if (hrFormat16bit) {
        heartRate = bytes.readUInt16LE(offset);
        offset += 2;
      } else {
        heartRate = bytes[offset];
        offset += 1;
      }

      if (heartRate < BIOMETRIC.HR_MIN || heartRate > BIOMETRIC.HR_MAX) return null;

      // R-R intervals present (bit 4 of flags)
      const rrPresent = (flags & 0x10) !== 0;
      const rrIntervals = [];
      if (rrPresent) {
        while (offset + 1 < bytes.length) {
          rrIntervals.push(bytes.readUInt16LE(offset) / 1024.0 * 1000); // ms
          offset += 2;
        }
      }

      return { heartRate, rrIntervals };
    } catch {
      return null;
    }
  }

  /** RMSSD – root mean square of successive differences (HRV metric) */
  _computeRMSSD(rrIntervals) {
    if (rrIntervals.length < 2) return null;
    const diffs = [];
    for (let i = 1; i < rrIntervals.length; i++) {
      diffs.push(Math.pow(rrIntervals[i] - rrIntervals[i - 1], 2));
    }
    return Math.sqrt(diffs.reduce((a, b) => a + b, 0) / diffs.length);
  }

  getCurrent() {
    return { hr: this._currentHR, hrv: this._currentHRV };
  }

  getConnectionState() {
    return {
      connected: this._isConnected,
      reconnecting: this._isReconnecting,
      reconnectAttempts: this._reconnectAttempts,
      deviceId: this._deviceId,
    };
  }
}

export default new WatchService();
