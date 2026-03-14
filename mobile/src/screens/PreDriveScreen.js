/**
 * PreDriveScreen.js
 * Peace of Mind route selection – scores routes by anxiety and shows comparison.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TextInput,
  TouchableOpacity, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import RouteScoring from '../services/RouteScoring';
import { COLORS } from '../utils/constants';

function RouteOption({ route, selected, onSelect }) {
  const score = route.anxietyScore;
  const barColor = score < 40 ? COLORS.accent : score < 70 ? COLORS.warning : COLORS.danger;

  return (
    <TouchableOpacity
      style={[styles.routeCard, selected && styles.routeCardSelected]}
      onPress={onSelect}
    >
      <View style={styles.routeHeader}>
        <Text style={styles.routeSummary} numberOfLines={1}>{route.summary || 'Route'}</Text>
        <View style={[styles.scoreBadge, { backgroundColor: `${barColor}22` }]}>
          <Text style={[styles.scoreText, { color: barColor }]}>{score}</Text>
        </View>
      </View>

      {/* Anxiety bar */}
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${score}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={styles.barLabel}>Anxiety score: {score}/100 (lower is calmer)</Text>

      <View style={styles.routeMeta}>
        <Text style={styles.metaItem}>⏱ {route.duration}</Text>
        <Text style={styles.metaItem}>📍 {route.distance}</Text>
      </View>

      {/* Breakdown */}
      <View style={styles.breakdown}>
        {Object.entries(route.breakdown).map(([key, val]) => (
          <Text key={key} style={styles.breakdownItem}>
            {factorLabel(key)}: <Text style={{ color: COLORS.text }}>{val}</Text>
          </Text>
        ))}
      </View>
    </TouchableOpacity>
  );
}

function factorLabel(key) {
  const map = {
    liveTraffic: '🚦 Traffic',
    highwayMerge: '🛣 Merges',
    accidentZones: '⚠️ Accident',
    heavyVehicles: '🚛 Heavy',
    narrowLanes: '🔀 Narrow',
  };
  return map[key] || key;
}

export default function PreDriveScreen({ navigation }) {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [routes, setRoutes] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!origin.trim() || !destination.trim()) {
      Alert.alert('Missing fields', 'Please enter both origin and destination.');
      return;
    }
    setLoading(true);
    try {
      const scored = await RouteScoring.scoreRoutes(origin.trim(), destination.trim(), { alternatives: true });
      setRoutes(scored);
      setSelectedIdx(0); // best (lowest score) first
    } catch (err) {
      Alert.alert('Route error', 'Could not fetch routes. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartDrive = () => {
    if (routes.length === 0) return;
    const chosen = routes[selectedIdx];
    navigation.navigate('Drive', {
      routeMeta: {
        summary: chosen.summary,
        duration: chosen.duration,
        distance: chosen.distance,
        anxietyScore: chosen.anxietyScore,
        route: chosen.route,
      },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Plan Your Calm Route</Text>
        <Text style={styles.subtitle}>We'll find the least stressful path for you.</Text>

        <TextInput
          style={styles.input}
          placeholder="From (address or 'current location')"
          placeholderTextColor={COLORS.muted}
          value={origin}
          onChangeText={setOrigin}
        />
        <TextInput
          style={styles.input}
          placeholder="To (destination)"
          placeholderTextColor={COLORS.muted}
          value={destination}
          onChangeText={setDestination}
        />

        <TouchableOpacity style={styles.searchBtn} onPress={handleSearch} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.searchBtnText}>Find Calm Routes</Text>
          }
        </TouchableOpacity>

        {routes.length > 0 && (
          <>
            <Text style={styles.resultsTitle}>
              {routes.length} route{routes.length > 1 ? 's' : ''} found — sorted by calm score
            </Text>
            {routes.map((r, idx) => (
              <RouteOption
                key={idx}
                route={r}
                selected={selectedIdx === idx}
                onSelect={() => setSelectedIdx(idx)}
              />
            ))}
          </>
        )}
      </ScrollView>

      {routes.length > 0 && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.startBtn} onPress={handleStartDrive}>
            <Text style={styles.startBtnText}>🚗  Start Drive on Selected Route</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 20, paddingBottom: 120 },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.text, marginBottom: 6 },
  subtitle: { fontSize: 15, color: COLORS.textSecondary, marginBottom: 24 },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    color: COLORS.text,
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.muted,
  },
  searchBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  resultsTitle: { fontSize: 15, color: COLORS.textSecondary, marginBottom: 12 },
  routeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  routeCardSelected: { borderColor: COLORS.primary },
  routeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  routeSummary: { fontSize: 16, fontWeight: '700', color: COLORS.text, flex: 1, marginRight: 8 },
  scoreBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  scoreText: { fontSize: 18, fontWeight: '900' },
  barTrack: { height: 6, backgroundColor: COLORS.muted, borderRadius: 3, marginBottom: 6 },
  barFill: { height: '100%', borderRadius: 3 },
  barLabel: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 10 },
  routeMeta: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  metaItem: { fontSize: 14, color: COLORS.textSecondary },
  breakdown: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  breakdownItem: { fontSize: 12, color: COLORS.muted },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: COLORS.background },
  startBtn: { backgroundColor: COLORS.primary, borderRadius: 14, padding: 18, alignItems: 'center' },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
