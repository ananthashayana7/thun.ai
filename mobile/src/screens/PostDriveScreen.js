/**
 * PostDriveScreen.js
 * Post-drive feedback – shows stress timeline, confidence narrative (LLM),
 * and synthetic scenario variants for stress events.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import axios from 'axios';
import LocalStorage from '../services/LocalStorage';
import { COLORS, STRESS, API } from '../utils/constants';
import { useAnxietyProfileStore } from '../store/anxietyProfile';
import dayjs from 'dayjs';

export default function PostDriveScreen({ navigation, route: navRoute }) {
  const { sessionId, routeMeta, fromHistory } = navRoute.params ?? {};
  const { profile, updateThresholds } = useAnxietyProfileStore();

  const [session, setSession] = useState(null);
  const [narrative, setNarrative] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedbackError, setFeedbackError] = useState(null);

  useEffect(() => {
    if (sessionId) loadSession();
  }, [sessionId]);

  const loadSession = async () => {
    setLoading(true);
    const data = await LocalStorage.getDriveSession(sessionId);
    setSession(data);

    if (!fromHistory) {
      // Adaptive threshold calibration based on this session
      if (data?.anxietyScoreAvg) {
        const newBaseline = data.anxietyScoreAvg;
        const currentTrigger = profile?.thresholds?.stressIndexTrigger ?? 65;
        // Nudge trigger threshold toward recent average (smooth adaptation)
        const updated = Math.round(currentTrigger * 0.8 + newBaseline * 0.2 + 5);
        await updateThresholds({ stressIndexTrigger: Math.min(85, Math.max(40, updated)) });
      }
      // Request LLM feedback from backend
      await fetchFeedback(data);
    }
    setLoading(false);
  };

  const fetchFeedback = async (sessionData) => {
    if (!sessionData) return;
    try {
      const resp = await axios.post(
        `${API.BASE_URL}/feedback/generate`,
        {
          sessionId,
          anxietyScoreAvg: sessionData.anxiety_score_avg,
          peakStress: sessionData.peak_stress,
          stressEvents: sessionData.stressEvents?.slice(0, 10),
          routeMeta: sessionData.routeMeta,
          driverProfile: {
            name: profile?.name,
            thresholds: profile?.thresholds,
          },
        },
        { timeout: 35_000 }
      );
      setNarrative(resp.data?.narrative);
      setScenarios(resp.data?.scenarios ?? []);
    } catch (err) {
      setFeedbackError('Could not generate AI feedback. Please check your connection.');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Analysing your drive…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const avg = session?.anxiety_score_avg ?? 0;
  const peak = session?.peak_stress ?? 0;
  const eventCount = session?.stressEvents?.length ?? 0;

  const scoreColor = avg >= STRESS.CRITICAL ? COLORS.danger
    : avg >= STRESS.HIGH ? COLORS.warning
    : avg >= STRESS.MODERATE ? '#FFD60A'
    : COLORS.accent;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <Text style={styles.title}>Drive Complete 🏁</Text>
        <Text style={styles.subtitle}>
          {dayjs(session?.started_at).format('ddd, MMM D · h:mm A')}
        </Text>

        {/* Score summary */}
        <View style={styles.scoreCard}>
          <View style={styles.scoreBlock}>
            <Text style={[styles.scoreNum, { color: scoreColor }]}>{Math.round(avg)}</Text>
            <Text style={styles.scoreLabel}>Avg Stress</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.scoreBlock}>
            <Text style={styles.scoreNum}>{peak}</Text>
            <Text style={styles.scoreLabel}>Peak Stress</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.scoreBlock}>
            <Text style={styles.scoreNum}>{eventCount}</Text>
            <Text style={styles.scoreLabel}>Stress Events</Text>
          </View>
        </View>

        {/* AI Narrative */}
        <Text style={styles.sectionTitle}>Confidence Report</Text>
        {feedbackError ? (
          <Text style={styles.error}>{feedbackError}</Text>
        ) : narrative ? (
          <View style={styles.narrativeCard}>
            <Text style={styles.narrativeText}>{narrative}</Text>
          </View>
        ) : (
          <View style={styles.narrativeCard}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.loadingText}>Generating your personalised report…</Text>
          </View>
        )}

        {/* Scenario variants */}
        {scenarios.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>What You Could Do Next Time</Text>
            {scenarios.map((s, i) => (
              <View key={i} style={styles.scenarioCard}>
                <Text style={styles.scenarioTitle}>{s.title}</Text>
                <Text style={styles.scenarioBody}>{s.suggestion}</Text>
              </View>
            ))}
          </>
        )}

        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => navigation.navigate('Main')}
        >
          <Text style={styles.doneBtnText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 20, paddingBottom: 60 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  title: { fontSize: 28, fontWeight: '900', color: COLORS.text, marginBottom: 4 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 24 },
  scoreCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 28,
  },
  scoreBlock: { alignItems: 'center' },
  scoreNum: { fontSize: 40, fontWeight: '900', color: COLORS.text },
  scoreLabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },
  divider: { width: 1, backgroundColor: COLORS.muted },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 12 },
  narrativeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 18,
    marginBottom: 28,
    gap: 12,
  },
  narrativeText: { fontSize: 15, color: COLORS.text, lineHeight: 24 },
  loadingText: { color: COLORS.textSecondary, marginTop: 8 },
  error: { color: COLORS.danger, marginBottom: 16 },
  scenarioCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  scenarioTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  scenarioBody: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 21 },
  doneBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    marginTop: 16,
  },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
