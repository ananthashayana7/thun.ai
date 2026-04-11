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
import OBDService from '../services/OBDService';
import WatchService from '../services/WatchService';
import TTSService from '../services/TTSService';
import SyncService from '../services/SyncService';
import { API, COLORS, STRESS } from '../utils/constants';
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

function statusTone(status) {
  switch (status) {
    case 'live':
    case 'connected':
    case 'online':
      return COLORS.accent;
    case 'fallback':
    case 'reconnecting':
      return COLORS.warning;
    case 'offline':
    case 'not_wired':
    case 'disconnected':
      return COLORS.danger;
    default:
      return COLORS.textSecondary;
  }
}

function RuntimeRow({ label, value, status }) {
  const color = statusTone(status);
  return (
    <View style={styles.runtimeRow}>
      <Text style={styles.runtimeLabel}>{label}</Text>
      <View style={[styles.runtimeBadge, { backgroundColor: `${color}22` }]}> 
        <Text style={[styles.runtimeBadgeText, { color }]}>{value}</Text>
      </View>
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const { profile } = useAnxietyProfileStore();
  const [sessions, setSessions] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState(() => ({
    obd: OBDService.getConnectionState(),
    watch: WatchService.getConnectionState(),
    tts: TTSService.getRuntimeStatus(),
    sync: SyncService.getConnectionStatus(),
  }));

  const load = useCallback(async () => {
    const data = await LocalStorage.getDriveSessions(20);
    setSessions(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const refreshRuntime = () => {
      setRuntimeStatus({
        obd: OBDService.getConnectionState(),
        watch: WatchService.getConnectionState(),
        tts: TTSService.getRuntimeStatus(),
        sync: SyncService.getConnectionStatus(),
      });
    };

    refreshRuntime();
    const timer = setInterval(refreshRuntime, 1000);
    return () => clearInterval(timer);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const avgStress = sessions.length > 0
    ? Math.round(sessions.slice(0, 7).reduce((s, d) => s + (d.anxiety_score_avg ?? 0), 0) / Math.min(sessions.length, 7))
    : null;

  const obdStatus = runtimeStatus.obd.reconnecting
    ? { text: 'Reconnecting', state: 'reconnecting' }
    : runtimeStatus.obd.connected
      ? { text: 'Connected', state: 'connected' }
      : { text: 'Disconnected', state: 'disconnected' };

  const watchStatus = runtimeStatus.watch.reconnecting
    ? { text: 'Reconnecting', state: 'reconnecting' }
    : runtimeStatus.watch.connected
      ? { text: 'Connected', state: 'connected' }
      : { text: 'Disconnected', state: 'disconnected' };

  const voiceStatus = runtimeStatus.tts.sarvamConfigured
    ? { text: `Sarvam live (${runtimeStatus.tts.language})`, state: 'live' }
    : { text: `Native fallback (${runtimeStatus.tts.language})`, state: 'fallback' };

  const backendStatus = runtimeStatus.sync.connected
    ? { text: 'Online', state: 'online' }
    : { text: 'Offline / queueing', state: 'offline' };

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

        <View style={styles.memoryCard}>
          <Text style={styles.memoryLabel}>Tight-Space Confidence</Text>
          <Text style={styles.memoryValue}>{profile?.confidenceMemory?.spatialConfidenceScore ?? 18}</Text>
          <Text style={styles.memorySub}>
            {profile?.confidenceMemory?.tightPassageSuccesses ?? 0} successful narrow passages remembered by the system
          </Text>
        </View>

        <View style={styles.realityCard}>
          <Text style={styles.realityLabel}>Runtime Reality</Text>
          <Text style={styles.realityTitle}>What this build is actually using right now</Text>
          <Text style={styles.realityBody}>
            This panel reports active runtime paths, fallback behavior, and integrations that are not wired into the mobile app.
          </Text>

          <RuntimeRow label="Backend sync" value={backendStatus.text} status={backendStatus.state} />
          <RuntimeRow label="OBD adapter" value={obdStatus.text} status={obdStatus.state} />
          <RuntimeRow label="Watch sensor" value={watchStatus.text} status={watchStatus.state} />
          <RuntimeRow label="Voice engine" value={voiceStatus.text} status={voiceStatus.state} />
          <RuntimeRow label="ElevenLabs in mobile" value="Not wired" status="not_wired" />
          <RuntimeRow label="Ollama in mobile" value="Not wired" status="not_wired" />

          <View style={styles.realityFooter}>
            <Text style={styles.realityFootnote}>API endpoint: {API.BASE_URL}</Text>
            <Text style={styles.realityFootnote}>
              {runtimeStatus.tts.silenced
                ? `Voice muted above ${runtimeStatus.tts.speedGateKmh} km/h for safety`
                : `Voice safety gate at ${runtimeStatus.tts.speedGateKmh} km/h`}
            </Text>
          </View>
        </View>

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
  memoryCard: {
    backgroundColor: '#111927',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: `${COLORS.primary}33`,
  },
  memoryLabel: { fontSize: 13, color: COLORS.primary, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  memoryValue: { fontSize: 48, fontWeight: '900', color: COLORS.text, marginTop: 10 },
  memorySub: { fontSize: 13, color: COLORS.textSecondary, marginTop: 8, lineHeight: 18 },
  realityCard: {
    backgroundColor: '#111318',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#232A37',
  },
  realityLabel: {
    fontSize: 12,
    color: COLORS.warning,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  realityTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginTop: 8 },
  realityBody: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 20, marginTop: 8, marginBottom: 16 },
  runtimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1D2330',
  },
  runtimeLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  runtimeBadge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  runtimeBadgeText: { fontSize: 12, fontWeight: '800' },
  realityFooter: { marginTop: 14, gap: 6 },
  realityFootnote: { fontSize: 12, color: COLORS.textSecondary },
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
