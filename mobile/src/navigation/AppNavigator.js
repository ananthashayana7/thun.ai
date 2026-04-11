/**
 * AppNavigator.js
 * Root navigation structure for thun.ai
 * Stack: Onboarding → Main Tabs → Drive flow
 */
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import OnboardingScreen from '../screens/OnboardingScreen';
import HomeScreen from '../screens/HomeScreen';
import PreDriveScreen from '../screens/PreDriveScreen';
import DriveScreen from '../screens/DriveScreen';
import PostDriveScreen from '../screens/PostDriveScreen';
import TherapistScreen from '../screens/TherapistScreen';
import SettingsScreen from '../screens/SettingsScreen';

import { useAnxietyProfileStore } from '../store/anxietyProfile';
import RouteScoring from '../services/RouteScoring';
import SyncService from '../services/SyncService';
import TTSService from '../services/TTSService';
import ErrorTracker from '../services/ErrorTracker';
import { COLORS, API } from '../utils/constants';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarStyle: { backgroundColor: COLORS.background, borderTopWidth: 0 },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'Dashboard' }} />
      <Tab.Screen name="Therapist" component={TherapistScreen} options={{ tabBarLabel: 'Therapist' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'Settings' }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { profile, loadProfile } = useAnxietyProfileStore();
  const isOnboarded = profile?.onboardingComplete === true;

  useEffect(() => {
    // Load persisted profile on startup
    loadProfile();

    ErrorTracker.init({
      environment: __DEV__ ? 'development' : 'production',
      release: 'mobile@1.0.0',
    });

    SyncService.init().catch((error) => {
      console.warn('[AppNavigator] Sync service init failed:', error?.message || error);
    });

    // Wire up services that require API keys at app start
    if (API.GOOGLE_MAPS_KEY) {
      RouteScoring.setApiKey(API.GOOGLE_MAPS_KEY);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-initialise TTS whenever the profile language changes
  useEffect(() => {
    const lang = profile?.ttsLanguage || 'en-IN';
    TTSService.init(null, lang); // Sarvam key injected separately if available
    ErrorTracker.setUser(
      profile?.userId
        ? {
            id: profile.userId,
            email: profile.email,
          }
        : null
    );
  }, [profile?.email, profile?.ttsLanguage, profile?.userId]);

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={isOnboarded ? 'Main' : 'Onboarding'}
        screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      >
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="PreDrive" component={PreDriveScreen} />
        <Stack.Screen
          name="Drive"
          component={DriveScreen}
          options={{ gestureEnabled: false }}
        />
        <Stack.Screen name="PostDrive" component={PostDriveScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
