jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(),
  addEventListener: jest.fn(() => jest.fn()),
}));

jest.mock('axios', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../src/services/LocalStorage', () => ({
  getLatestCompletedSyncResult: jest.fn(),
  saveSyncRequest: jest.fn(),
  getPendingSyncRequests: jest.fn(),
  updateSyncRequestStatus: jest.fn(),
}));

import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import LocalStorage from '../src/services/LocalStorage';
import SyncService from '../src/services/SyncService';

describe('SyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    SyncService._isInitialized = false;
    SyncService._isConnected = true;
    SyncService._isFlushing = false;
    SyncService._listeners = new Map();
    SyncService._unsubscribeNetInfo = null;

    NetInfo.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    LocalStorage.getLatestCompletedSyncResult.mockResolvedValue(null);
    LocalStorage.saveSyncRequest.mockResolvedValue(null);
    LocalStorage.getPendingSyncRequests.mockResolvedValue([]);
    LocalStorage.updateSyncRequestStatus.mockResolvedValue(null);
  });

  it('returns a cached completed response when dedupe is enabled', async () => {
    LocalStorage.getLatestCompletedSyncResult.mockResolvedValue({
      responseData: { narrative: 'cached' },
      status: 'completed',
    });

    const result = await SyncService.request({
      requestKey: 'feedback.generate.session-1',
      method: 'POST',
      url: 'https://api.thun.ai/feedback/generate',
      dedupeCompleted: true,
      cacheOnSuccess: true,
    });

    expect(result).toEqual({ status: 'success', data: { narrative: 'cached' }, cached: true });
    expect(axios).not.toHaveBeenCalled();
  });

  it('queues a request when offline before sending', async () => {
    NetInfo.fetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });

    const result = await SyncService.request({
      requestKey: 'feedback.generate.session-2',
      method: 'POST',
      url: 'https://api.thun.ai/feedback/generate',
      body: { sessionId: 'session-2' },
      queueIfOffline: true,
    });

    expect(result).toEqual({ status: 'queued' });
    expect(LocalStorage.saveSyncRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestKey: 'feedback.generate.session-2',
      status: 'pending',
    }));
    expect(axios).not.toHaveBeenCalled();
  });

  it('flushes queued work and emits completed data', async () => {
    const listener = jest.fn();
    SyncService.subscribe('feedback.generate.session-3', listener);

    LocalStorage.getPendingSyncRequests.mockResolvedValue([
      {
        request_key: 'feedback.generate.session-3',
        method: 'POST',
        url: 'https://api.thun.ai/feedback/generate',
        body: { sessionId: 'session-3' },
        headers: {},
        attempt_count: 0,
      },
    ]);
    axios.mockResolvedValue({ data: { narrative: 'synced', scenarios: [] } });

    await SyncService.flushPending();

    expect(LocalStorage.updateSyncRequestStatus).toHaveBeenCalledWith(
      'feedback.generate.session-3',
      'completed',
      expect.objectContaining({
        responseData: { narrative: 'synced', scenarios: [] },
        attemptCount: 1,
      })
    );
    expect(listener).toHaveBeenCalledWith({ status: 'completed', data: { narrative: 'synced', scenarios: [] }, cached: false });
  });
});