/**
 * PrivacyService.js
 * Coordinates local consent state with protected backend privacy endpoints.
 */
import SyncService from './SyncService';
import AuthSessionService from './AuthSessionService';
import { API, PRIVACY } from '../utils/constants';

class PrivacyService {
  async syncConsent(settings) {
    const authStatus = await AuthSessionService.getProvisioningStatus();
    if (!authStatus.tokenPresent) {
      return { status: 'local_only' };
    }

    return SyncService.request({
      requestKey: `privacy.consent.${PRIVACY.CONSENT_VERSION}`,
      method: 'PUT',
      url: `${API.BASE_URL}/privacy/consent`,
      body: {
        consentVersion: PRIVACY.CONSENT_VERSION,
        telemetryUpload: settings.telemetryUpload,
        biometricsProcessing: settings.biometricsProcessing,
        therapistTranscriptRetention: settings.therapistTranscriptRetention,
        marketingUpdates: settings.marketingUpdates ?? false,
      },
      queueIfOffline: true,
    });
  }

  async requestDataExport() {
    const authStatus = await AuthSessionService.getProvisioningStatus();
    if (!authStatus.tokenPresent) {
      return { status: 'local_only' };
    }

    return SyncService.request({
      requestKey: `privacy.export.${Date.now()}`,
      method: 'POST',
      url: `${API.BASE_URL}/privacy/export`,
      body: { format: 'json' },
      queueIfOffline: true,
    });
  }

  async requestDeletion(reason) {
    const authStatus = await AuthSessionService.getProvisioningStatus();
    if (!authStatus.tokenPresent) {
      return { status: 'local_only' };
    }

    return SyncService.request({
      requestKey: `privacy.delete.${Date.now()}`,
      method: 'POST',
      url: `${API.BASE_URL}/privacy/delete-account`,
      body: {
        confirm: true,
        reason: reason || 'Requested from mobile settings',
      },
      queueIfOffline: true,
    });
  }
}

export default new PrivacyService();
