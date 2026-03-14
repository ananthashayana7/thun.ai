/**
 * HomeScreen.js
 * Main dashboard – shows drive history, stress trends, and quick-start CTA.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  SafeAreaView, RefreshControl,
} from 'react-native';
import { useAnxietyProfileStore } from '../store/anxietyProfile';
import LocalStorage from '../services/LocalStorage';
import { COLORS, STRESS } from '../utils/constants';
import dayjs from 'dayjs';

function StressBadge({ score }) {
  let color = COLORS.accent;
  let label = 'Calm';
  if (score >= STRESS.CRITICAL) { color = COLORS.danger; label = 'Critical'; }
  else if (score >= STRESS.HIGH) { color = COLORS.warning; label = 'High'; }
  else if (score >= STRESS.MODERATE) { color = '#FFD60A'; label = 'Moderate'; }
  return (
    <View style={[styles.badge, { backgroundColor: `${color}22` }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function DriveCard({ session, onPress }) {
  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(session)}>
      <View style={styles.cardRow}>
        <Text style={styles.cardDate}>{dayjs(session.started_at).format('ddd, MMM D · h:mm A')}</Text>
        <StressBadge score={session.anxiety_score_avg ?? 0} />
      </View>
      <Text style={styles.cardRoute} numberOfLines={1}>
        {session.routeMeta?.summary || 'Drive session'}
      </Text>
      <View style={styles.cardMeta}>
        <Text style={styles.cardMetaText}>⏱ {session.routeMeta?.duration || '—'}</Text>
        <Text style={styles.cardMetaText}>📍 {session.routeMeta?.distance || '—'}</Text>
        <Text style={styles.cardMetaText}>💥 Peak: {session.peak_stress ?? '—'}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function HomeScreen({ navigation }) {
  const { profile } = useAnxietyProfileStore();
  const [sessions, setSessions] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await LocalStorage.getDriveSessions(20);
    setSessions(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const avgStress = sessions.length > 0
    ? Math.round(sessions.slice(0, 7).reduce((s, d) => s + (d.anxiety_score_avg ?? 0), 0) / Math.min(sessions.length, 7))
    : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hello, {profile?.name || 'Driver'} 👋</Text>
            <Text style={styles.subtitle}>Ready for a calm journey?</Text>
          </View>
        </View>

        {/* 7-day stat card */}
        {avgStress !== null && (
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>7-Day Average Stress</Text>
            <Text style={[
              styles.statValue,
              { color: avgStress >= STRESS.HIGH ? COLORS.warning : COLORS.accent }
            ]}>
              {avgStress}
            </Text>
            <Text style={styles.statSub}>out of 100</Text>
          </View>
        )}

        {/* Start drive CTA */}
        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => navigation.navigate('PreDrive')}
        >
          <Text style={styles.ctaText}>🚗  Start a Calm Drive</Text>
        </TouchableOpacity>

        {/* Drive history */}
        <Text style={styles.sectionTitle}>Recent Drives</Text>
        {sessions.length === 0 ? (
          <Text style={styles.empty}>No drives yet. Start your first calm journey!</Text>
        ) : (
          sessions.map((s) => (
            <DriveCard
              key={s.id}
              session={s}
              onPress={() => navigation.navigate('PostDrive', { sessionId: s.id, fromHistory: true })}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  greeting: { fontSize: 26, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 15, color: COLORS.textSecondary, marginTop: 4 },
  statCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  statLabel: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 8 },
  statValue: { fontSize: 64, fontWeight: '900' },
  statSub: { fontSize: 13, color: COLORS.muted },
  ctaButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 32,
  },
  ctaText: { fontSize: 18, fontWeight: '700', color: '#fff' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 12 },
  empty: { color: COLORS.muted, textAlign: 'center', paddingVertical: 40 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cardDate: { fontSize: 13, color: COLORS.textSecondary },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  cardRoute: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  cardMeta: { flexDirection: 'row', gap: 16 },
  cardMetaText: { fontSize: 13, color: COLORS.muted },
});
