/**
 * SettingsScreen.js
 * User settings – thresholds, intervention preferences, device pairing, language.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  Switch, TouchableOpacity, Alert, TextInput,
} from 'react-native';
import { useAnxietyProfileStore } from '../store/anxietyProfile';
import OBDService from '../services/OBDService';
import WatchService from '../services/WatchService';
import { COLORS } from '../utils/constants';

const LANGUAGES = [
  { label: 'English (India)', value: 'en-IN' },
  { label: 'हिन्दी', value: 'hi-IN' },
  { label: 'தமிழ்', value: 'ta-IN' },
  { label: 'తెలుగు', value: 'te-IN' },
];

export default function SettingsScreen({ navigation }) {
  const { profile, updateProfile, updateThresholds, resetProfile } = useAnxietyProfileStore();

  const [prefs, setPrefs] = useState(profile?.interventionPrefs ?? {
    calmAudio: true, hudOverlay: true, breathingCue: true, laneGuidance: true,
  });
  const [threshold, setThreshold] = useState(String(profile?.thresholds?.stressIndexTrigger ?? 65));

  const togglePref = async (key) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await updateProfile({ interventionPrefs: next });
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

  const handleReset = () => {
    Alert.alert('Reset Profile', 'This will delete all your settings and drive history. Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: async () => {
        await resetProfile();
        navigation.replace('Onboarding');
      }},
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Settings</Text>

        {/* Profile */}
        <SectionHeader title="Profile" />
        <InfoRow label="Name" value={profile?.name || '—'} />

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
        <SectionHeader title="Account" />
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
  label: { fontSize: 15, color: COLORS.text },
  value: { fontSize: 15, color: COLORS.textSecondary },
  thresholdInput: {
    backgroundColor: COLORS.background, borderRadius: 8, padding: 8,
    color: COLORS.text, fontSize: 18, fontWeight: '700', width: 56, textAlign: 'center',
    borderWidth: 1, borderColor: COLORS.muted,
  },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 6 },
  saveBtnText: { color: '#fff', fontWeight: '700' },
  hint: { fontSize: 12, color: COLORS.muted, marginBottom: 8 },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
  },
  switchLabel: { fontSize: 15, color: COLORS.text },
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
