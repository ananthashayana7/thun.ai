/**
 * OBDService.js
 * Connects to the OBD-2 adapter via Bluetooth Classic and parses ELM327 PIDs.
 * Emits real-time telemetry: speed, RPM, throttle, engine load, coolant temp.
 */
import { NativeEventEmitter } from 'react-native';
import RNBluetoothClassic from 'react-native-bluetooth-classic';
import { OBD } from '../utils/constants';

const ELM327_INIT = ['ATZ', 'ATE0', 'ATL0', 'ATSP0'];

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
    this._pollTimer = null;
    this._listeners = [];
    this._lastData = {};
  }

  async connect(deviceAddress) {
    try {
      const connected = await RNBluetoothClassic.connectToDevice(deviceAddress);
      if (!connected) throw new Error('BT connection failed');
      this._device = connected;
      await this._initElm327();
      return true;
    } catch (err) {
      console.error('[OBDService] connect error:', err);
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
    this._listeners.push(onData);

    if (this._pollTimer) return; // already polling
    this._pollTimer = setInterval(async () => {
      const telemetry = {};
      for (const [pid, key] of Object.entries(PID_MAP)) {
        try {
          const raw = await this._queryPID(pid);
          telemetry[key] = this._parsePID(pid, raw);
        } catch {
          telemetry[key] = this._lastData[key] ?? null;
        }
      }
      // Derived: infer current gear from speed/RPM (heuristic)
      telemetry[OBD.GEAR] = this._inferGear(
        telemetry[OBD.SPEED],
        telemetry[OBD.RPM]
      );
      this._lastData = telemetry;
      this._listeners.forEach((cb) => cb(telemetry));
    }, POLL_INTERVAL_MS);
  }

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._listeners = [];
  }

  async disconnect() {
    this.stopPolling();
    if (this._device) {
      await this._device.disconnect();
      this._device = null;
    }
  }

  async _queryPID(pid) {
    await this._device.write(`${pid}\r`);
    // Read response with timeout; unsubscribe listener to prevent memory leak
    return new Promise((resolve, reject) => {
      let subscription = null;
      const timeout = setTimeout(() => {
        if (subscription) subscription.remove();
        reject(new Error('PID timeout'));
      }, 500);
      subscription = this._device.onDataReceived(({ data }) => {
        clearTimeout(timeout);
        subscription.remove();
        resolve(data.trim());
      });
    });
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
}

export default new OBDService();
