/**
 * DriveScreen.js
 * Real-time IVIS during a drive.
 * Orchestrates: OBD polling → WatchService → StressIndex → IVISEngine
 * Renders: HUD overlay, stress gauge, breathing cue animation, intervention toasts.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity,
  Animated, Alert, AppState, StatusBar,
} from 'react-native';
import { nanoid } from 'nanoid/non-secure';
import OBDService from '../services/OBDService';
import WatchService from '../services/WatchService';
import IVISEngine from '../services/IVISEngine';
import ConfidenceCorridorService from '../services/ConfidenceCorridorService';
import LocalStorage from '../services/LocalStorage';
import SyncService from '../services/SyncService';
import { useAnxietyProfileStore } from '../store/anxietyProfile';
import { COLORS, INTERVENTION } from '../utils/constants';

const TICK_INTERVAL_MS = 200;

export default function DriveScreen({ navigation, route: navRoute }) {
  const { profile, updateProfile } = useAnxietyProfileStore();
  const routeMetaRef = useRef(navRoute.params?.routeMeta ?? {});
  const routeMeta = routeMetaRef.current;

  const [sessionId] = useState(() => nanoid());
  const [stressScore, setStressScore] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [rpm, setRpm] = useState(0);
  const [hudEvent, setHudEvent] = useState(null);
  const [breathingActive, setBreathingActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [corridorState, setCorridorState] = useState(() => ConfidenceCorridorService.getCurrentState());
  const [obdConnection, setObdConnection] = useState(() => OBDService.getConnectionState());
  const [watchConnection, setWatchConnection] = useState(() => WatchService.getConnectionState());
  const [syncStatus, setSyncStatus] = useState(() => SyncService.getConnectionStatus());

  const tickRef = useRef(null);
  const timerRef = useRef(null);
  const startTime = useRef(Date.now());
  const biometrics = useRef({ hr: null, hrv: null });
  const breathAnim = useRef(new Animated.Value(1)).current;
  const initialProfileRef = useRef(profile);

  const startBreathAnimation = useCallback(() => {
    Animated.sequence([
      Animated.timing(breathAnim, { toValue: 2, duration: 4000, useNativeDriver: true }),
      Animated.timing(breathAnim, { toValue: 2, duration: 7000, useNativeDriver: true }),
      Animated.timing(breathAnim, { toValue: 1, duration: 8000, useNativeDriver: true }),
    ]).start(() => setBreathingActive(false));
  }, [breathAnim]);

  // ─── Session start ─────────────────────────────────────────────────────────
  useEffect(() => {
    IVISEngine.start(sessionId, initialProfileRef.current);
    ConfidenceCorridorService.startSession(
      initialProfileRef.current,
      routeMeta,
    );
    setCorridorState(ConfidenceCorridorService.getCurrentState());

    // HUD listener
    const offHud = IVISEngine.onHUDUpdate((event) => {
      setHudEvent(event);
      setTimeout(() => setHudEvent(null), 4000);
    });

    // Breathing cue listener
    const offBreath = IVISEngine.onBreathingCue(({ active }) => {
      setBreathingActive(active);
      if (active) startBreathAnimation();
    });

    // Watch streaming
    WatchService.startStreaming((bio) => {
      biometrics.current = bio;
    });

    const offObdConnection = OBDService.onConnectionChange((state) => {
      setObdConnection(state);
    });

    const offWatchConnection = WatchService.onConnectionChange((state) => {
      setWatchConnection(state);
    });

    const offSyncHealth = SyncService.subscribeHealth((state) => {
      setSyncStatus(state);
    });

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        OBDService.ensureConnection().catch(() => {});
        WatchService.ensureConnection().catch(() => {});
        SyncService.recoverNow().catch(() => {});
      }
    });

    // Tick loop
    tickRef.current = setInterval(async () => {
      const obd = OBDService.getLastData();
      const bio = biometrics.current;
      const cvSignals = {}; // populated by edge via BLE/WebSocket in production

      await IVISEngine.processTick(obd, bio, cvSignals);
      const nextStressScore = IVISEngine.getLastStressScore();
      setStressScore(nextStressScore);
      setSpeed(obd?.speed ?? 0);
      setRpm(obd?.rpm ?? 0);
      setCorridorState(
        ConfidenceCorridorService.update({
          elapsedSeconds: Math.floor((Date.now() - startTime.current) / 1000),
          speedKmh: obd?.speed ?? 0,
          stressScore: nextStressScore,
          cvSignals,
        })
      );
    }, TICK_INTERVAL_MS);

    // Elapsed timer
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);

    return () => {
      clearInterval(tickRef.current);
      clearInterval(timerRef.current);
      offHud();
      offBreath();
      offObdConnection();
      offWatchConnection();
      offSyncHealth();
      appStateSubscription.remove();
      WatchService.stopStreaming();
      ConfidenceCorridorService.stopSession();
    };
  }, [routeMeta, sessionId, startBreathAnimation]);

  const endDrive = useCallback(async () => {
    Alert.alert('End Drive?', 'Are you sure you want to end this drive session?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End Drive',
        style: 'destructive',
        onPress: async () => {
          clearInterval(tickRef.current);
          clearInterval(timerRef.current);
          IVISEngine.stop();
          WatchService.stopStreaming();

          const summary = IVISEngine.getSessionSummary();
          const corridorSummary = ConfidenceCorridorService.getSessionSummary();
          const nextConfidenceMemory = ConfidenceCorridorService.mergeProfileConfidence(profile, corridorSummary);
          if (corridorSummary?.encountered) {
            await updateProfile({ confidenceMemory: nextConfidenceMemory });
          }
          await LocalStorage.saveDriveSession({
            id: sessionId,
            startedAt: new Date(startTime.current).toISOString(),
            endedAt: new Date().toISOString(),
            routeMeta,
            telemetrySummary: {
              confidenceCorridor: corridorSummary,
            },
            stressEvents: summary?.stressEvents ?? [],
            anxietyScoreAvg: summary?.anxietyScoreAvg ?? 0,
            peakStress: summary?.peakStress ?? 0,
          });
          ConfidenceCorridorService.stopSession();
          navigation.replace('PostDrive', { sessionId, routeMeta });
        },
      },
    ]);
  }, [navigation, profile, routeMeta, sessionId, updateProfile]);

  const stressColor = stressScore >= 85 ? COLORS.danger
    : stressScore >= 65 ? COLORS.warning
    : stressScore >= 40 ? '#FFD60A'
    : COLORS.accent;

  const elapsedStr = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const corridorColor = corridorState?.status === 'stop'
    ? COLORS.danger
    : corridorState?.status === 'caution'
      ? COLORS.warning
      : COLORS.accent;
  const systemWarnings = [];
  if (obdConnection?.state === 'reconnecting') {
    systemWarnings.push('Reconnecting OBD adapter');
  } else if (obdConnection?.connected === false) {
    systemWarnings.push('OBD adapter offline - vehicle telemetry degraded');
  }

  if (watchConnection?.state === 'reconnecting') {
    systemWarnings.push('Reconnecting heart-rate sensor');
  } else if (watchConnection?.connected === false) {
    systemWarnings.push('Heart-rate sensor offline - biometrics degraded');
  }

  if (!syncStatus.connected) {
    systemWarnings.push(
      syncStatus.queuedRequestCount > 0
        ? `${syncStatus.queuedRequestCount} sync item(s) queued for replay`
        : 'Backend offline - syncing paused'
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerRoute} numberOfLines={1}>{routeMeta.summary || 'Active Drive'}</Text>
          <Text style={styles.headerTime}>{elapsedStr}</Text>
        </View>
        <TouchableOpacity style={styles.endBtn} onPress={endDrive}>
          <Text style={styles.endBtnText}>End</Text>
        </TouchableOpacity>
      </View>

      {profile?.interventionPrefs?.confidenceCorridor !== false && corridorState?.mode !== 'idle' && (
        <View style={[styles.corridorCard, { borderColor: `${corridorColor}66` }]}>
          <View style={styles.corridorHeader}>
            <View>
              <Text style={[styles.corridorEyebrow, { color: corridorColor }]}>Spatial Confidence Corridor</Text>
              <Text style={styles.corridorTitle}>{corridorState.segmentLabel || 'Tight passage assist'}</Text>
            </View>
            <View style={[styles.corridorStatusBadge, { backgroundColor: `${corridorColor}22` }]}>
              <Text style={[styles.corridorStatusText, { color: corridorColor }]}>
                {corridorState.statusLabel || 'Watching Ahead'}
              </Text>
            </View>
          </View>

          <Text style={styles.corridorMessage}>{corridorState.message}</Text>

          <View style={styles.corridorMetrics}>
            <CorridorMetric label="Space to spare" value={corridorState.spareCm ? `${corridorState.spareCm} cm` : '-'} />
            <CorridorMetric label="Vehicle width" value={corridorState.vehicleWidthCm ? `${corridorState.vehicleWidthCm} cm` : '-'} />
            <CorridorMetric label="Target speed" value={corridorState.recommendedSpeedKmh !== undefined ? `${corridorState.recommendedSpeedKmh} km/h` : '-'} />
          </View>

          <View style={styles.corridorVisual}>
            <View style={[styles.corridorRail, { backgroundColor: `${corridorColor}33` }]} />
            <View style={styles.corridorVehicle}>
              <Text style={styles.corridorVehicleText}>{corridorState.vehicleWidthCm ? `${corridorState.vehicleWidthCm} cm` : 'Car'}</Text>
            </View>
            <View style={[styles.corridorRail, { backgroundColor: `${corridorColor}33` }]} />
          </View>

          <Text style={styles.corridorTrust}>
            {corridorState.tightPassageSuccesses ?? 0} successful tight passages | confidence {corridorState.spatialConfidenceScore ?? 18}/100
          </Text>
        </View>
      )}

      {/* Stress gauge */}
      <View style={styles.gaugeSection}>
        <Text style={styles.gaugeLabel}>Stress Index</Text>
        <Text style={[styles.gaugeValue, { color: stressColor }]}>{stressScore}</Text>
        <View style={styles.gaugeTrack}>
          <Animated.View style={[styles.gaugeFill, { width: `${stressScore}%`, backgroundColor: stressColor }]} />
        </View>
      </View>

      {/* OBD telemetry */}
      {systemWarnings.length > 0 && (
        <View style={styles.sensorBanner}>
          <Text style={styles.sensorBannerText}>{systemWarnings.join(' | ')}</Text>
        </View>
      )}

      <View style={styles.telemetry}>
        <View style={styles.telemCard}>
          <Text style={styles.telemValue}>{speed}</Text>
          <Text style={styles.telemLabel}>km/h</Text>
        </View>
        <View style={styles.telemCard}>
          <Text style={styles.telemValue}>{Math.round(rpm)}</Text>
          <Text style={styles.telemLabel}>RPM</Text>
        </View>
        <View style={styles.telemCard}>
          <Text style={styles.telemValue}>{biometrics.current.hr ?? '—'}</Text>
          <Text style={styles.telemLabel}>HR bpm</Text>
        </View>
      </View>

      {/* Breathing cue overlay */}
      {breathingActive && (
        <View style={styles.breathingOverlay}>
          <Animated.View style={[styles.breathCircle, { transform: [{ scale: breathAnim }] }]} />
          <Text style={styles.breathText}>Breathe with the circle</Text>
        </View>
      )}

      {/* HUD event toast */}
      {hudEvent && (
        <View style={[styles.hudToast, { borderColor: hudEvent.type === INTERVENTION.EMERGENCY_VEHICLE ? COLORS.danger : COLORS.primary }]}>
          <Text style={styles.hudToastText}>{hudEventMessage(hudEvent)}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function CorridorMetric({ label, value }) {
  return (
    <View style={styles.corridorMetric}>
      <Text style={styles.corridorMetricLabel}>{label}</Text>
      <Text style={styles.corridorMetricValue}>{value}</Text>
    </View>
  );
}

function hudEventMessage(event) {
  switch (event.type) {
    case INTERVENTION.EMERGENCY_VEHICLE: return '🚨 Emergency vehicle – yield left';
    case INTERVENTION.LANE_GUIDANCE: return '↔️ Check your lane position';
    case INTERVENTION.BREATHING_CUE: return '🫁 Follow the breathing circle';
    case INTERVENTION.STALL_PROTOCOL: return '🛑 Safely stopped – breathe';
    case INTERVENTION.HUD_ICON: return `⚠️ Stress elevated (${event.stressScore})`;
    default: return '💙 Stay calm';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080A0F' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20 },
  headerRoute: { fontSize: 18, fontWeight: '700', color: COLORS.text, maxWidth: 220 },
  headerTime: { fontSize: 28, fontWeight: '900', color: COLORS.primary, marginTop: 2 },
  endBtn: { backgroundColor: COLORS.danger, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  endBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  corridorCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
  },
  corridorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  corridorEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 },
  corridorTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  corridorStatusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  corridorStatusText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  corridorMessage: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 12 },
  corridorMetrics: { flexDirection: 'row', marginTop: 14, gap: 10 },
  corridorMetric: { flex: 1, backgroundColor: '#121621', borderRadius: 12, padding: 10 },
  corridorMetricLabel: { color: COLORS.textSecondary, fontSize: 11, marginBottom: 4 },
  corridorMetricValue: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  corridorVisual: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  corridorRail: { flex: 1, height: 58, borderRadius: 14 },
  corridorVehicle: {
    width: 112,
    height: 74,
    borderRadius: 16,
    backgroundColor: '#E7EDF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  corridorVehicleText: { color: '#152033', fontSize: 14, fontWeight: '800' },
  corridorTrust: { color: COLORS.textSecondary, fontSize: 12, marginTop: 14 },
  gaugeSection: { alignItems: 'center', paddingVertical: 32 },
  gaugeLabel: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 8 },
  gaugeValue: { fontSize: 96, fontWeight: '900', lineHeight: 100 },
  gaugeTrack: { width: '80%', height: 10, backgroundColor: COLORS.surface, borderRadius: 5, marginTop: 16 },
  gaugeFill: { height: '100%', borderRadius: 5 },
  sensorBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: `${COLORS.warning}22`,
    borderWidth: 1,
    borderColor: `${COLORS.warning}55`,
  },
  sensorBannerText: { color: COLORS.warning, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  telemetry: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 20, paddingVertical: 16 },
  telemCard: { alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, flex: 1, marginHorizontal: 6 },
  telemValue: { fontSize: 28, fontWeight: '800', color: COLORS.text },
  telemLabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },
  breathingOverlay: { position: 'absolute', bottom: 80, left: 0, right: 0, alignItems: 'center' },
  breathCircle: { width: 120, height: 120, borderRadius: 60, backgroundColor: `${COLORS.primary}44`, borderWidth: 3, borderColor: COLORS.primary },
  breathText: { color: COLORS.text, marginTop: 16, fontSize: 16, fontWeight: '600' },
  hudToast: {
    position: 'absolute', bottom: 40, left: 20, right: 20,
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 18,
    borderWidth: 2, alignItems: 'center',
  },
  hudToastText: { color: COLORS.text, fontWeight: '700', fontSize: 16, textAlign: 'center' },
});
