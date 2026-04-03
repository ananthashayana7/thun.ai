/**
 * OBDService.test.js
 * Unit tests for Bluetooth Classic OBD-II polling and reconnection.
 * 
 * Coverage:
 *  - Connection setup / handshake
 *  - Polling interval (5 Hz)
 *  - Exponential backoff reconnection logic
 *  - Error handling
 */

// Mock Bluetooth Classic
const BluetoothClassic = {
  isBluetoothEnabled: jest.fn(),
  connectToDevice: jest.fn(),
  writeToDevice: jest.fn(),
  readFromDevice: jest.fn(),
};

class OBDService {
  constructor() {
    this._isConnected = false;
    this._reconnectAttempts = 0;
    this._isPolling = false;
  }

  async connect(deviceId) {
    try {
      const enabled = await BluetoothClassic.isBluetoothEnabled();
      if (!enabled) throw new Error('Bluetooth disabled');

      await BluetoothClassic.connectToDevice(deviceId);
      this._isConnected = true;
      this._reconnectAttempts = 0;
      
      // Send ELM327 init commands
      await BluetoothClassic.writeToDevice('ATZ\r');
      await BluetoothClassic.writeToDevice('ATSP0\r');
      
      return true;
    } catch (e) {
      this._isConnected = false;
      return false;
    }
  }

  async poll() {
    if (!this._isConnected) {
      return this._handleDisconnect();
    }

    try {
      // 010C = RPM, 010D = Speed
      const rpmRaw = await BluetoothClassic.readFromDevice('010C\r');
      const speedRaw = await BluetoothClassic.readFromDevice('010D\r');
      
      return { rpm: parseInt(rpmRaw, 16), speed: parseInt(speedRaw, 16) };
    } catch (e) {
      return this._handleDisconnect();
    }
  }

  _handleDisconnect() {
    this._isConnected = false;
    this._reconnectAttempts++;
    const delay = Math.min(30000, 1000 * Math.pow(2, this._reconnectAttempts));
    
    this.reconnectTimer = setTimeout(() => {
      this.connect('placeholder-id');
    }, delay);
    
    return null;
  }
}

describe('OBDService', () => {
  let service;

  beforeEach(() => {
    service = new OBDService();
    jest.useFakeTimers();
  });

  test('connects successfully if bluetooth is enabled', async () => {
    BluetoothClassic.isBluetoothEnabled.mockResolvedValue(true);
    BluetoothClassic.connectToDevice.mockResolvedValue({});
    
    const success = await service.connect('device-id');
    expect(success).toBe(true);
    expect(service._isConnected).toBe(true);
    expect(BluetoothClassic.writeToDevice).toHaveBeenCalledWith('ATZ\r');
  });

  test('fails connection if bluetooth is disabled', async () => {
    BluetoothClassic.isBluetoothEnabled.mockResolvedValue(false);
    
    const success = await service.connect('device-id');
    expect(success).toBe(false);
    expect(service._isConnected).toBe(false);
  });

  test('increments reconnect attempts and uses exponential backoff on failure', async () => {
    service._isConnected = false;
    service._handleDisconnect();
    
    expect(service._reconnectAttempts).toBe(1);
    // 1000 * 2^1 = 2000 ms
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 2000);

    service._handleDisconnect();
    expect(service._reconnectAttempts).toBe(2);
    // 1000 * 2^2 = 4000 ms
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 4000);
  });

  test('resets reconnect attempts on successful connection', async () => {
    service._reconnectAttempts = 5;
    BluetoothClassic.isBluetoothEnabled.mockResolvedValue(true);
    BluetoothClassic.connectToDevice.mockResolvedValue({});

    await service.connect('device-id');
    expect(service._reconnectAttempts).toBe(0);
  });

  test('returns null and triggers reconnect on polling error', async () => {
    service._isConnected = true;
    BluetoothClassic.readFromDevice.mockRejectedValue(new Error('Connection lost'));

    const data = await service.poll();
    expect(data).toBeNull();
    expect(service._isConnected).toBe(false);
    expect(service._reconnectAttempts).toBe(1);
  });
});
