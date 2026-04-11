/**
 * OBDService.js
 * Connects to the OBD-2 adapter via Bluetooth Classic and parses ELM327 PIDs.
 * Emits real-time telemetry: speed, RPM, throttle, engine load, coolant temp.
 */
import RNBluetoothClassic from 'react-native-bluetooth-classic';
import { OBD } from '../utils/constants';

const ELM327_INIT = ['ATZ', 'ATE0', 'ATL0', 'ATSP0'];
const MAX_RECONNECT_DELAY_MS = 30000;
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

const PID_MAP = {
  '010D': OBD.SPEED,        // Vehicle speed (km/h)
  '010C': OBD.RPM,          // Engine RPM
  '0111': OBD.THROTTLE,     // Throttle position (%)
  '0104': OBD.ENGINE_LOAD,  // Engine load (%)
  '0105': OBD.COOLANT_TEMP, // Coolant temperature (°C)
};

const POLL_INTERVAL_MS = 200; // 5 Hz

class OBDService {
  constructor() {
    this._device = null;
    this._deviceAddress = null;
    this._pollTimer = null;
    this._listeners = [];
    this._connectionListeners = [];
    this._lastData = {};
    this._lastPollSnapshot = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._isReconnecting = false;
    this._isConnected = false;
    this._manualDisconnect = false;
    this._consecutivePollErrors = 0;
    this._lastError = null;
    this._lastHeartbeatAt = null;
  }

  async connect(deviceAddress, opts = {}) {
    const { resetBackoff = true } = opts;

    try {
      this._manualDisconnect = false;
      this._deviceAddress = deviceAddress;
      const connected = await RNBluetoothClassic.connectToDevice(deviceAddress);
      if (!connected) throw new Error('BT connection failed');
      this._device = connected;
      await this._initElm327();
      if (resetBackoff) {
        this._reconnectAttempts = 0;
      }
      this._isConnected = true;
      this._isReconnecting = false;
      this._consecutivePollErrors = 0;
      this._lastError = null;
      this._emitConnectionState('connected');
      return true;
    } catch (err) {
      console.error('[OBDService] connect error:', err);
      this._isConnected = false;
      this._lastError = err?.message || 'Unknown connect error';
      this._emitConnectionState('disconnected', err);
      return false;
    }
  }

  async _initElm327() {
    for (const cmd of ELM327_INIT) {
      await this._device.write(`${cmd}\r`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  startPolling(onData) {
    if (!this._device) {
      console.warn('[OBDService] startPolling called without connection');
      return;
    }
    if (typeof onData === 'function' && !this._listeners.includes(onData)) {
      this._listeners.push(onData);
    }

    if (this._pollTimer) return; // already polling
    this._pollTimer = setInterval(async () => {
      const telemetry = {};
      let cycleErrors = 0;

      for (const [pid, key] of Object.entries(PID_MAP)) {
        try {
          const raw = await this._queryPID(pid);
          telemetry[key] = this._parsePID(pid, raw);
        } catch (err) {
          cycleErrors += 1;
          telemetry[key] = this._lastData[key] ?? null;
          if (cycleErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
            console.warn('[OBDService] polling degraded, scheduling reconnect:', err.message);
            this._scheduleReconnect(err);
            break;
          }
        }
      }

      // Derived: infer current gear from speed/RPM (heuristic)
      telemetry[OBD.GEAR] = this._inferGear(
        telemetry[OBD.SPEED],
        telemetry[OBD.RPM]
      );
      this._consecutivePollErrors = cycleErrors === 0 ? 0 : this._consecutivePollErrors + 1;
      this._lastData = telemetry;
      this._lastPollSnapshot = {
        telemetry,
        timestamp: Date.now(),
        healthy: cycleErrors === 0,
      };
      this._lastHeartbeatAt = this._lastPollSnapshot.timestamp;
      this._listeners.forEach((cb) => cb(telemetry));
    }, POLL_INTERVAL_MS);
  }

  stopPolling({ preserveListeners = false } = {}) {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
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
    this.stopPolling();
    if (this._device) {
      await this._device.disconnect();
      this._device = null;
    }
    this._isConnected = false;
    this._isReconnecting = false;
    this._emitConnectionState('disconnected');
  }

  async ensureConnection() {
    if (this._isConnected || this._isReconnecting || !this._deviceAddress) {
      return this._isConnected;
    }

    const connected = await this.connect(this._deviceAddress, { resetBackoff: false });
    if (connected) {
      this.startPolling();
    }
    return connected;
  }

  async _queryPID(pid) {
    if (!this._device) {
      throw new Error('OBD device not connected');
    }

    await this._device.write(`${pid}\r`);
    // Read response with timeout; unsubscribe listener to prevent memory leak
    return new Promise((resolve, reject) => {
      let subscription = this._device.onDataReceived(({ data }) => {
        clearTimeout(timeout);
        subscription.remove();
        resolve(data.trim());
      });
      const timeout = setTimeout(() => {
        subscription.remove();
        reject(new Error('PID timeout'));
      }, 500);
    });
  }

  _scheduleReconnect(reason) {
    if (this._manualDisconnect || this._isReconnecting || !this._deviceAddress) {
      return;
    }

    this._isReconnecting = true;
    this._isConnected = false;
    this.stopPolling({ preserveListeners: true });

    if (this._device) {
      this._device.disconnect().catch(() => {});
      this._device = null;
    }

    const delay = Math.min(1000 * (2 ** this._reconnectAttempts), MAX_RECONNECT_DELAY_MS);
    this._reconnectAttempts += 1;
    this._emitConnectionState('reconnecting', reason, { delay });

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      const reconnected = await this.connect(this._deviceAddress, { resetBackoff: false });
      if (reconnected) {
        this.startPolling();
      } else {
        this._isReconnecting = false;
        this._scheduleReconnect(reason);
      }
    }, delay);
  }

  _emitConnectionState(state, error = null, meta = {}) {
    this._lastError = error ? error.message : this._lastError;
    const payload = {
      state,
      connected: state === 'connected',
      reconnectAttempts: this._reconnectAttempts,
      error: error ? error.message : null,
      lastHeartbeatAt: this._lastHeartbeatAt,
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

  _parsePID(pid, raw) {
    // Extract hex bytes after mode+PID echo
    const bytes = raw
      .replace(/>/g, '')
      .trim()
      .split(/\s+/)
      .map((b) => parseInt(b, 16))
      .filter((b) => !isNaN(b));

    if (bytes.length < 3) return null;
    const [, , A, B] = bytes; // bytes[0]=mode, bytes[1]=pid, bytes[2]=A, bytes[3]=B

    switch (pid) {
      case '010D': return A; // speed km/h
      case '010C': return ((A * 256 + B) / 4); // RPM
      case '0111': return (A * 100) / 255; // throttle %
      case '0104': return (A * 100) / 255; // engine load %
      case '0105': return A - 40; // coolant °C
      default: return null;
    }
  }

  /** Rough gear estimation: speed(km/h) / RPM ratio */
  _inferGear(speed, rpm) {
    if (!speed || !rpm || rpm < 500) return 0; // neutral / off
    const ratio = speed / (rpm / 1000);
    if (ratio < 5) return 1;
    if (ratio < 9) return 2;
    if (ratio < 13) return 3;
    if (ratio < 18) return 4;
    if (ratio < 24) return 5;
    return 6;
  }

  getLastData() {
    return this._lastData;
  }

  getConnectionState() {
    return {
      connected: this._isConnected,
      reconnecting: this._isReconnecting,
      reconnectAttempts: this._reconnectAttempts,
      lastPollSnapshot: this._lastPollSnapshot,
      deviceAddress: this._deviceAddress,
      lastError: this._lastError,
      lastHeartbeatAt: this._lastHeartbeatAt,
    };
  }
}

export default new OBDService();
