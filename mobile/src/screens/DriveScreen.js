/**
 * DriveScreen.js
 * Real-time IVIS during a drive.
 * Orchestrates: OBD polling → WatchService → StressIndex → IVISEngine
 * Renders: HUD overlay, stress gauge, breathing cue animation, intervention toasts.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity,
  Animated, Alert, StatusBar,
} from 'react-native';
import { nanoid } from 'nanoid/non-secure';
import OBDService from '../services/OBDService';
import WatchService from '../services/WatchService';
import IVISEngine from '../services/IVISEngine';
import LocalStorage from '../services/LocalStorage';
import { useAnxietyProfileStore } from '../store/anxietyProfile';
import { COLORS, INTERVENTION, DRIVE_STATE } from '../utils/constants';

const TICK_INTERVAL_MS = 200;

export default function DriveScreen({ navigation, route: navRoute }) {
  const { profile } = useAnxietyProfileStore();
  const routeMeta = navRoute.params?.routeMeta ?? {};

  const [sessionId] = useState(() => nanoid());
  const [stressScore, setStressScore] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [rpm, setRpm] = useState(0);
  const [hudEvent, setHudEvent] = useState(null);
  const [breathingActive, setBreathingActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const tickRef = useRef(null);
  const timerRef = useRef(null);
  const startTime = useRef(Date.now());
  const biometrics = useRef({ hr: null, hrv: null });
  const breathAnim = useRef(new Animated.Value(1)).current;

  // ─── Session start ─────────────────────────────────────────────────────────
  useEffect(() => {
    IVISEngine.start(sessionId, profile);

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

    // Tick loop
    tickRef.current = setInterval(async () => {
      const obd = OBDService.getLastData();
      const bio = biometrics.current;
      const cvSignals = {}; // populated by edge via BLE/WebSocket in production

      await IVISEngine.processTick(obd, bio, cvSignals);
      setStressScore(IVISEngine.getLastStressScore());
      setSpeed(obd?.speed ?? 0);
      setRpm(obd?.rpm ?? 0);
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
      WatchService.stopStreaming();
    };
  }, []);

  const startBreathAnimation = () => {
    Animated.sequence([
      Animated.timing(breathAnim, { toValue: 2, duration: 4000, useNativeDriver: true }),
      Animated.timing(breathAnim, { toValue: 2, duration: 7000, useNativeDriver: true }),
      Animated.timing(breathAnim, { toValue: 1, duration: 8000, useNativeDriver: true }),
    ]).start(() => setBreathingActive(false));
  };

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
          await LocalStorage.saveDriveSession({
            id: sessionId,
            startedAt: new Date(startTime.current).toISOString(),
            endedAt: new Date().toISOString(),
            routeMeta,
            telemetrySummary: {},
            stressEvents: summary?.stressEvents ?? [],
            anxietyScoreAvg: summary?.anxietyScoreAvg ?? 0,
            peakStress: summary?.peakStress ?? 0,
          });
          navigation.replace('PostDrive', { sessionId, routeMeta });
        },
      },
    ]);
  }, [sessionId, routeMeta]);

  const stressColor = stressScore >= 85 ? COLORS.danger
    : stressScore >= 65 ? COLORS.warning
    : stressScore >= 40 ? '#FFD60A'
    : COLORS.accent;

  const elapsedStr = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

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

      {/* Stress gauge */}
      <View style={styles.gaugeSection}>
        <Text style={styles.gaugeLabel}>Stress Index</Text>
        <Text style={[styles.gaugeValue, { color: stressColor }]}>{stressScore}</Text>
        <View style={styles.gaugeTrack}>
          <Animated.View style={[styles.gaugeFill, { width: `${stressScore}%`, backgroundColor: stressColor }]} />
        </View>
      </View>

      {/* OBD telemetry */}
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
  gaugeSection: { alignItems: 'center', paddingVertical: 32 },
  gaugeLabel: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 8 },
  gaugeValue: { fontSize: 96, fontWeight: '900', lineHeight: 100 },
  gaugeTrack: { width: '80%', height: 10, backgroundColor: COLORS.surface, borderRadius: 5, marginTop: 16 },
  gaugeFill: { height: '100%', borderRadius: 5 },
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
