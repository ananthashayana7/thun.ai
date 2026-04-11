/**
 * SettingsScreen.js
 * User settings – thresholds, intervention preferences, device pairing, language.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  Switch, TouchableOpacity, Alert, TextInput,
} from 'react-native';
import { useAnxietyProfileStore } from '../store/anxietyProfile';
import AuthSessionService from '../services/AuthSessionService';
import LocalStorage from '../services/LocalStorage';
import PrivacyService from '../services/PrivacyService';
import { COLORS, PRIVACY } from '../utils/constants';

const LANGUAGES = [
  { label: 'English (India)', value: 'en-IN' },
  { label: 'हिन्दी', value: 'hi-IN' },
  { label: 'தமிழ்', value: 'ta-IN' },
  { label: 'తెలుగు', value: 'te-IN' },
];

function formatTimestamp(value) {
  if (!value) return 'Not requested';

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function SettingsScreen({ navigation }) {
  const { profile, updateProfile, updateThresholds, resetProfile } = useAnxietyProfileStore();

  const [prefs, setPrefs] = useState(profile?.interventionPrefs ?? {
    calmAudio: true, hudOverlay: true, breathingCue: true, laneGuidance: true, confidenceCorridor: true,
  });
  const [triggerPrefs, setTriggerPrefs] = useState(profile?.triggerPreferences ?? {
    avoidFlyovers: false,
    avoidUTurns: false,
    avoidHighwayMerges: false,
    avoidNarrowLanes: false,
  });
  const [privacy, setPrivacy] = useState(profile?.privacy ?? {
    version: PRIVACY.CONSENT_VERSION,
    ...PRIVACY.DEFAULTS,
  });
  const [threshold, setThreshold] = useState(String(profile?.thresholds?.stressIndexTrigger ?? 65));
  const [vehicleWidth, setVehicleWidth] = useState(String(profile?.vehicleProfile?.mirrorWidthCm ?? 182));
  const [backendToken, setBackendToken] = useState('');
  const [backendProvisioning, setBackendProvisioning] = useState({
    tokenPresent: false,
    provisionedFromEnvironment: false,
    provisionedFromStorage: false,
  });
  const [storageStatus, setStorageStatus] = useState({
    secureStorageRequired: false,
    nativeModuleAvailable: false,
    keystoreBacked: false,
    usingDevelopmentFallback: true,
  });
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  useEffect(() => {
    setPrefs(profile?.interventionPrefs ?? {
      calmAudio: true, hudOverlay: true, breathingCue: true, laneGuidance: true, confidenceCorridor: true,
    });
    setTriggerPrefs(profile?.triggerPreferences ?? {
      avoidFlyovers: false,
      avoidUTurns: false,
      avoidHighwayMerges: false,
      avoidNarrowLanes: false,
    });
    setThreshold(String(profile?.thresholds?.stressIndexTrigger ?? 65));
    setVehicleWidth(String(profile?.vehicleProfile?.mirrorWidthCm ?? 182));
    setPrivacy({
      version: PRIVACY.CONSENT_VERSION,
      ...PRIVACY.DEFAULTS,
      ...(profile?.privacy || {}),
    });
  }, [profile]);

  useEffect(() => {
    refreshSecurityStatus().catch((error) => {
      console.warn('[SettingsScreen] runtime status load failed:', error?.message || error);
    });
  }, []);

  const refreshSecurityStatus = async () => {
    const [nextStorageStatus, nextBackendProvisioning] = await Promise.all([
      LocalStorage.getRuntimeStorageStatus(),
      AuthSessionService.getProvisioningStatus(),
    ]);
    setStorageStatus(nextStorageStatus);
    setBackendProvisioning(nextBackendProvisioning);
  };

  const togglePref = async (key) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await updateProfile({ interventionPrefs: next });
  };

  const toggleTriggerPref = async (key) => {
    const next = { ...triggerPrefs, [key]: !triggerPrefs[key] };
    setTriggerPrefs(next);
    await updateProfile({ triggerPreferences: next });
  };

  const togglePrivacyPref = (key) => {
    setPrivacy((current) => ({ ...current, [key]: !current[key] }));
  };

  const saveThreshold = async () => {
    const val = parseInt(threshold, 10);
    if (isNaN(val) || val < 30 || val > 95) {
      Alert.alert('Invalid threshold', 'Please enter a value between 30 and 95.');
      return;
    }
    await updateThresholds({ stressIndexTrigger: val });
    Alert.alert('Saved', 'Stress trigger threshold updated.');
  };

  const saveVehicleWidth = async () => {
    const val = parseInt(vehicleWidth, 10);
    if (isNaN(val) || val < 145 || val > 240) {
      Alert.alert('Invalid width', 'Enter your mirror-to-mirror width between 145 cm and 240 cm.');
      return;
    }

    await updateProfile({
      vehicleProfile: {
        ...(profile?.vehicleProfile || {}),
        mirrorWidthCm: val,
      },
    });
    Alert.alert('Saved', 'Vehicle width updated. Narrow-lane guidance will use the new width.');
  };

  const savePrivacySettings = async () => {
    const nextPrivacy = {
      ...privacy,
      version: PRIVACY.CONSENT_VERSION,
    };

    setSavingPrivacy(true);
    try {
      await updateProfile({ privacy: nextPrivacy });
      const result = await PrivacyService.syncConsent(nextPrivacy);
      await refreshSecurityStatus();

      if (result.status === 'queued') {
        Alert.alert('Consent queued', 'Your privacy updates are saved locally and will sync when the backend is reachable.');
        return;
      }

      if (result.status === 'local_only') {
        Alert.alert(
          'Saved locally',
          'Privacy settings are encrypted on-device. Provision a backend token to sync them to the server during pilot setup.'
        );
        return;
      }

      Alert.alert('Saved', 'Privacy and consent settings updated.');
    } catch (error) {
      Alert.alert('Save failed', error?.message || 'Could not update privacy settings.');
    } finally {
      setSavingPrivacy(false);
    }
  };

  const saveBackendProvisioning = async () => {
    if (!backendToken.trim()) {
      Alert.alert('Token required', 'Paste the backend token returned during device provisioning.');
      return;
    }

    try {
      await AuthSessionService.setBackendToken(backendToken);
      setBackendToken('');
      await refreshSecurityStatus();
      Alert.alert('Provisioned', 'Protected API calls can now authenticate against the backend.');
    } catch (error) {
      Alert.alert('Provisioning failed', error?.message || 'Could not save the backend token.');
    }
  };

  const clearBackendProvisioning = async () => {
    await AuthSessionService.clearBackendToken();
    await refreshSecurityStatus();
    Alert.alert('Cleared', 'The saved backend token has been removed from this device.');
  };

  const handleExportRequest = () => {
    Alert.alert(
      'Request Data Export',
      'This queues a JSON export request for the currently provisioned account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request',
          onPress: async () => {
            const nextPrivacy = {
              ...privacy,
              dataExportRequestedAt: new Date().toISOString(),
            };
            setPrivacy(nextPrivacy);
            await updateProfile({ privacy: nextPrivacy });

            const result = await PrivacyService.requestDataExport();
            if (result.status === 'queued') {
              Alert.alert('Queued', 'The export request will be submitted automatically when connectivity returns.');
            } else if (result.status === 'local_only') {
              Alert.alert('Saved locally', 'A local export request marker was recorded. Provision a backend token to submit it server-side.');
            } else {
              Alert.alert('Requested', 'The data export request was accepted.');
            }
          },
        },
      ]
    );
  };

  const handleDeletionRequest = () => {
    Alert.alert(
      'Request Account Deletion',
      'This queues a server-side deletion request. Local encrypted data will remain on-device until you explicitly reset the profile.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request deletion',
          style: 'destructive',
          onPress: async () => {
            const nextPrivacy = {
              ...privacy,
              deletionRequestedAt: new Date().toISOString(),
            };
            setPrivacy(nextPrivacy);
            await updateProfile({ privacy: nextPrivacy });

            const result = await PrivacyService.requestDeletion('Requested from Settings screen');
            if (result.status === 'queued') {
              Alert.alert('Queued', 'Deletion will be submitted automatically when the backend becomes reachable.');
            } else if (result.status === 'local_only') {
              Alert.alert('Saved locally', 'A local deletion marker was recorded. Provision a backend token to submit the server-side request.');
            } else {
              Alert.alert('Requested', 'The deletion request was accepted.');
            }
          },
        },
      ]
    );
  };

  const handleReset = () => {
    Alert.alert('Reset Profile', 'This will delete all your settings and drive history. Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: async () => {
        await resetProfile();
        navigation.replace('Onboarding');
      }},
    ]);
  };

  const secureStorageLabel = storageStatus.keystoreBacked
    ? 'Keystore-backed'
    : storageStatus.usingDevelopmentFallback
      ? 'Development fallback'
      : 'Unavailable';
  const backendSessionLabel = backendProvisioning.tokenPresent
    ? backendProvisioning.provisionedFromEnvironment
      ? 'Provisioned from build env'
      : 'Provisioned on device'
    : 'Not provisioned';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Settings</Text>

        {/* Profile */}
        <SectionHeader title="Profile" />
        <InfoRow label="Name" value={profile?.name || '—'} />

        <InfoRow label="Spatial confidence" value={`${profile?.confidenceMemory?.spatialConfidenceScore ?? 18}/100`} />

        <SectionHeader title="Security & Provisioning" />
        <InfoRow label="Secure local storage" value={secureStorageLabel} />
        <InfoRow label="Backend session" value={backendSessionLabel} />
        <Text style={styles.hint}>
          Pilot devices can be pre-provisioned with the backend JWT returned by `POST /auth/verify`.
        </Text>
        <TextInput
          style={styles.tokenInput}
          value={backendToken}
          onChangeText={setBackendToken}
          placeholder="Paste backend token"
          placeholderTextColor={COLORS.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity style={styles.saveBtn} onPress={saveBackendProvisioning}>
          <Text style={styles.saveBtnText}>Save Backend Token</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={clearBackendProvisioning}>
          <Text style={styles.secondaryBtnText}>Clear Provisioned Token</Text>
        </TouchableOpacity>

        <SectionHeader title="Vehicle Profile" />
        <View style={styles.row}>
          <Text style={styles.label}>Mirror-to-mirror width (cm)</Text>
          <TextInput
            style={styles.thresholdInput}
            value={vehicleWidth}
            onChangeText={setVehicleWidth}
            keyboardType="number-pad"
            maxLength={3}
          />
        </View>
        <TouchableOpacity style={styles.saveBtn} onPress={saveVehicleWidth}>
          <Text style={styles.saveBtnText}>Save Vehicle Width</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>This width powers the green or red confidence corridor in tight spaces.</Text>

        {/* Stress threshold */}
        <SectionHeader title="Intervention Threshold" />
        <View style={styles.row}>
          <Text style={styles.label}>Trigger stress score (30–95)</Text>
          <TextInput
            style={styles.thresholdInput}
            value={threshold}
            onChangeText={setThreshold}
            keyboardType="number-pad"
            maxLength={2}
          />
        </View>
        <TouchableOpacity style={styles.saveBtn} onPress={saveThreshold}>
          <Text style={styles.saveBtnText}>Save Threshold</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>Lower = more interventions. Higher = fewer interruptions.</Text>

        {/* Intervention prefs */}
        <SectionHeader title="Intervention Types" />
        {[
          ['calmAudio', '🔊 Calm Voice Prompts'],
          ['hudOverlay', '📺 HUD Icon Overlay'],
          ['breathingCue', '🫁 Breathing Cue Animation'],
          ['laneGuidance', '↔️ Lane Guidance Alerts'],
        ].map(([key, label]) => (
          <View key={key} style={styles.switchRow}>
            <Text style={styles.switchLabel}>{label}</Text>
            <Switch
              value={prefs[key] ?? true}
              onValueChange={() => togglePref(key)}
              trackColor={{ true: COLORS.primary }}
              thumbColor={prefs[key] ? '#fff' : COLORS.muted}
            />
          </View>
        ))}

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Narrow-lane confidence corridor</Text>
          <Switch
            value={prefs.confidenceCorridor ?? true}
            onValueChange={() => togglePref('confidenceCorridor')}
            trackColor={{ true: COLORS.primary }}
            thumbColor={(prefs.confidenceCorridor ?? true) ? '#fff' : COLORS.muted}
          />
        </View>

        <SectionHeader title="Route Trigger Preferences" />
        {[
          ['avoidNarrowLanes', 'Avoid narrow lanes when possible'],
          ['avoidHighwayMerges', 'Avoid highway merges when possible'],
          ['avoidFlyovers', 'Avoid flyovers when possible'],
          ['avoidUTurns', 'Avoid U-turns when possible'],
        ].map(([key, label]) => (
          <View key={key} style={styles.switchRow}>
            <Text style={styles.switchLabel}>{label}</Text>
            <Switch
              value={triggerPrefs[key] ?? false}
              onValueChange={() => toggleTriggerPref(key)}
              trackColor={{ true: COLORS.primary }}
              thumbColor={(triggerPrefs[key] ?? false) ? '#fff' : COLORS.muted}
            />
          </View>
        ))}

        <SectionHeader title="Privacy & Consent" />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Upload driving telemetry for sync and feedback</Text>
          <Switch
            value={privacy.telemetryUpload ?? true}
            onValueChange={() => togglePrivacyPref('telemetryUpload')}
            trackColor={{ true: COLORS.primary }}
            thumbColor={(privacy.telemetryUpload ?? true) ? '#fff' : COLORS.muted}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Process watch biometrics during drives</Text>
          <Switch
            value={privacy.biometricsProcessing ?? true}
            onValueChange={() => togglePrivacyPref('biometricsProcessing')}
            trackColor={{ true: COLORS.primary }}
            thumbColor={(privacy.biometricsProcessing ?? true) ? '#fff' : COLORS.muted}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Retain therapist transcripts after sessions</Text>
          <Switch
            value={privacy.therapistTranscriptRetention ?? false}
            onValueChange={() => togglePrivacyPref('therapistTranscriptRetention')}
            trackColor={{ true: COLORS.primary }}
            thumbColor={(privacy.therapistTranscriptRetention ?? false) ? '#fff' : COLORS.muted}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Receive product and pilot updates</Text>
          <Switch
            value={privacy.marketingUpdates ?? false}
            onValueChange={() => togglePrivacyPref('marketingUpdates')}
            trackColor={{ true: COLORS.primary }}
            thumbColor={(privacy.marketingUpdates ?? false) ? '#fff' : COLORS.muted}
          />
        </View>
        <TouchableOpacity style={styles.saveBtn} onPress={savePrivacySettings} disabled={savingPrivacy}>
          <Text style={styles.saveBtnText}>{savingPrivacy ? 'Saving...' : 'Save Privacy Settings'}</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>Consent version {PRIVACY.CONSENT_VERSION}</Text>
        <InfoRow label="Last export request" value={formatTimestamp(privacy.dataExportRequestedAt)} />
        <InfoRow label="Last deletion request" value={formatTimestamp(privacy.deletionRequestedAt)} />
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleExportRequest}>
          <Text style={styles.secondaryBtnText}>Request Data Export</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dangerBtn} onPress={handleDeletionRequest}>
          <Text style={styles.dangerBtnText}>Request Account Deletion</Text>
        </TouchableOpacity>

        {/* Language */}
        <SectionHeader title="Voice Language" />
        {LANGUAGES.map((lang) => (
          <TouchableOpacity
            key={lang.value}
            style={[styles.langOption, profile?.ttsLanguage === lang.value && styles.langSelected]}
            onPress={() => updateProfile({ ttsLanguage: lang.value })}
          >
            <Text style={[styles.langText, profile?.ttsLanguage === lang.value && { color: COLORS.primary }]}>
              {lang.label}
            </Text>
          </TouchableOpacity>
        ))}

        {/* Danger zone */}
        <SectionHeader title="Local Device Data" />
        <TouchableOpacity style={styles.dangerBtn} onPress={handleReset}>
          <Text style={styles.dangerBtnText}>Reset Profile & History</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title }) {
  return <Text style={styles.sectionHeader}>{title.toUpperCase()}</Text>;
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 20, paddingBottom: 60 },
  title: { fontSize: 28, fontWeight: '900', color: COLORS.text, marginBottom: 24 },
  sectionHeader: { fontSize: 11, color: COLORS.muted, letterSpacing: 1.5, marginTop: 28, marginBottom: 12 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
  },
  label: { flex: 1, fontSize: 15, color: COLORS.text, paddingRight: 12 },
  value: { fontSize: 15, color: COLORS.textSecondary, maxWidth: '45%', textAlign: 'right' },
  thresholdInput: {
    backgroundColor: COLORS.background, borderRadius: 8, padding: 8,
    color: COLORS.text, fontSize: 18, fontWeight: '700', width: 56, textAlign: 'center',
    borderWidth: 1, borderColor: COLORS.muted,
  },
  tokenInput: {
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14,
    color: COLORS.text, fontSize: 14, borderWidth: 1, borderColor: COLORS.muted, marginBottom: 10,
  },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 6 },
  saveBtnText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: {
    borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.muted, backgroundColor: COLORS.surface,
  },
  secondaryBtnText: { color: COLORS.text, fontWeight: '700' },
  hint: { fontSize: 12, color: COLORS.muted, marginBottom: 8, lineHeight: 18 },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
  },
  switchLabel: { flex: 1, fontSize: 15, color: COLORS.text, paddingRight: 12 },
  langOption: {
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 2, borderColor: 'transparent',
  },
  langSelected: { borderColor: COLORS.primary },
  langText: { fontSize: 15, color: COLORS.text },
  dangerBtn: {
    borderWidth: 2, borderColor: COLORS.danger, borderRadius: 12,
    padding: 14, alignItems: 'center', marginTop: 8,
  },
  dangerBtnText: { color: COLORS.danger, fontWeight: '700', fontSize: 15 },
});
