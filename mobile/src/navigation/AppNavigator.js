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
import { COLORS } from '../utils/constants';

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
  const { profile } = useAnxietyProfileStore();
  const isOnboarded = profile?.onboardingComplete === true;

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
