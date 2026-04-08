/**
 * OnboardingScreen.js
 * Collects the core anxiety profile needed for route scoring, IVIS, and
 * the narrow-lane confidence corridor.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, SafeAreaView, Alert,
} from 'react-native';
import { useAnxietyProfileStore } from '../store/anxietyProfile';
import { COLORS, VEHICLE_DEFAULTS } from '../utils/constants';

const QUESTIONS = [
  {
    id: 'drivingExperience',
    text: 'How long have you been driving on your own?',
    options: ['Under 6 months', '6-24 months', '2-5 years', '5+ years'],
  },
  {
    id: 'anxietyTriggers',
    text: 'Which situations make your hands tighten on the wheel?',
    options: ['Night driving', 'Rain', 'Heavy traffic', 'Highway merges', 'Narrow lanes'],
    multi: true,
  },
  {
    id: 'accidentHistory',
    text: 'Have you had an accident or near-miss that still affects you?',
    options: ['No', 'Minor near-miss', 'Minor accident', 'Serious accident'],
  },
  {
    id: 'judgmentSensitivity',
    text: 'How much do passengers or nearby drivers make you feel judged?',
    options: ['Not at all', 'A little', 'Quite a lot', 'Very strongly'],
  },
  {
    id: 'driveAvoidance',
    text: 'How often do you avoid driving because it feels overwhelming?',
    options: ['Never', 'Sometimes', 'Often', 'Almost always'],
  },
];

const VEHICLE_OPTIONS = [
  { label: 'Hatchback', bodyWidthCm: 170, mirrorWidthCm: 176 },
  { label: 'Compact SUV', bodyWidthCm: 176, mirrorWidthCm: 182 },
  { label: 'Sedan', bodyWidthCm: 179, mirrorWidthCm: 185 },
];

const LANGUAGES = [
  { label: 'English', value: 'en-IN' },
  { label: 'हिन्दी', value: 'hi-IN' },
  { label: 'தமிழ்', value: 'ta-IN' },
  { label: 'తెలుగు', value: 'te-IN' },
  { label: 'ಕನ್ನಡ', value: 'kn-IN' },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function deriveProfile(answers, vehicleProfile) {
  const experienceWeights = {
    'Under 6 months': 28,
    '6-24 months': 18,
    '2-5 years': 10,
    '5+ years': 4,
  };
  const accidentWeights = {
    No: 0,
    'Minor near-miss': 10,
    'Minor accident': 18,
    'Serious accident': 28,
  };
  const judgmentWeights = {
    'Not at all': 0,
    'A little': 8,
    'Quite a lot': 16,
    'Very strongly': 24,
  };
  const avoidanceWeights = {
    Never: 0,
    Sometimes: 10,
    Often: 20,
    'Almost always': 30,
  };

  const triggerCount = (answers.anxietyTriggers || []).length;
  const anxietySensitivityScore = clamp(
    experienceWeights[answers.drivingExperience] +
    accidentWeights[answers.accidentHistory] +
    judgmentWeights[answers.judgmentSensitivity] +
    avoidanceWeights[answers.driveAvoidance] +
    triggerCount * 6,
    18,
    95
  );

  const stressIndexTrigger = clamp(Math.round(84 - anxietySensitivityScore * 0.45), 40, 80);
  const triggerPreferences = {
    avoidFlyovers: false,
    avoidUTurns: false,
    avoidHighwayMerges: (answers.anxietyTriggers || []).includes('Highway merges'),
    avoidNarrowLanes: (answers.anxietyTriggers || []).includes('Narrow lanes'),
  };

  return {
    anxietySensitivityScore,
    triggerPreferences,
    thresholds: {
      stressIndexTrigger,
      hrRestingBaseline: 72,
      hrvBaseline: 45,
      speedVarianceLimit: 15,
    },
    vehicleProfile,
  };
}

export default function OnboardingScreen({ navigation }) {
  const { updateProfile } = useAnxietyProfileStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en-IN');
  const [vehicleProfile, setVehicleProfile] = useState({
    label: VEHICLE_DEFAULTS.LABEL,
    bodyWidthCm: VEHICLE_DEFAULTS.BODY_WIDTH_CM,
    mirrorWidthCm: VEHICLE_DEFAULTS.MIRROR_WIDTH_CM,
  });
  const [answers, setAnswers] = useState({});

  const totalSteps = 4 + QUESTIONS.length;
  const questionIndex = step - 4;
  const currentQuestion = QUESTIONS[questionIndex];

  const handleAnswer = (questionId, value, multi) => {
    if (multi) {
      const previous = answers[questionId] || [];
      setAnswers((current) => ({
        ...current,
        [questionId]: previous.includes(value)
          ? previous.filter((item) => item !== value)
          : [...previous, value],
      }));
      return;
    }

    setAnswers((current) => ({ ...current, [questionId]: value }));
  };

  const completeOnboarding = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter your name to continue.');
      setStep(1);
      return;
    }

    const derived = deriveProfile(answers, vehicleProfile);
    await updateProfile({
      onboardingComplete: true,
      name: name.trim(),
      ttsLanguage: language,
      questionnaire: answers,
      anxietySensitivityScore: derived.anxietySensitivityScore,
      triggerPreferences: derived.triggerPreferences,
      thresholds: derived.thresholds,
      vehicleProfile: derived.vehicleProfile,
    });
    navigation.replace('Main');
  };

  const handleNext = async () => {
    if (step < totalSteps - 1) {
      setStep((current) => current + 1);
      return;
    }

    await completeOnboarding();
  };

  const canProceed = () => {
    if (step === 1) return Boolean(name.trim());
    if (step === 3) return Boolean(vehicleProfile?.mirrorWidthCm);
    if (step >= 4 && currentQuestion) {
      const answer = answers[currentQuestion.id];
      if (currentQuestion.multi) return Array.isArray(answer) && answer.length > 0;
      return Boolean(answer);
    }
    return true;
  };

  const renderStep = () => {
    if (step === 0) {
      return (
        <View style={styles.center}>
          <Text style={styles.logo}>thun.ai</Text>
          <Text style={styles.tagline}>Calm drives start with an honest baseline</Text>
          <Text style={styles.subText}>
            This takes under five minutes. We will learn what makes driving hard for you,
            how wide your vehicle is, and where we should step in with calm, factual support.
          </Text>
        </View>
      );
    }

    if (step === 1) {
      return (
        <View style={styles.section}>
          <Text style={styles.question}>What should we call you?</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={COLORS.muted}
            autoFocus
          />
        </View>
      );
    }

    if (step === 2) {
      return (
        <View style={styles.section}>
          <Text style={styles.question}>Preferred language for voice guidance</Text>
          {LANGUAGES.map((lang) => (
            <TouchableOpacity
              key={lang.value}
              style={[styles.option, language === lang.value && styles.optionSelected]}
              onPress={() => setLanguage(lang.value)}
            >
              <Text style={[styles.optionText, language === lang.value && styles.optionTextSelected]}>
                {lang.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      );
    }

    if (step === 3) {
      return (
        <View style={styles.section}>
          <Text style={styles.question}>Which vehicle profile is closest to yours?</Text>
          <Text style={styles.helperText}>
            We use mirror-to-mirror width to tell you, in real time, whether a narrow gap is real or only feels scary.
          </Text>
          {VEHICLE_OPTIONS.map((vehicle) => {
            const selected = vehicleProfile.label === vehicle.label;
            return (
              <TouchableOpacity
                key={vehicle.label}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => setVehicleProfile(vehicle)}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                  {vehicle.label}
                </Text>
                <Text style={styles.optionMeta}>
                  Body {vehicle.bodyWidthCm} cm  |  Mirrors {vehicle.mirrorWidthCm} cm
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }

    if (!currentQuestion) return null;

    const selected = answers[currentQuestion.id] || (currentQuestion.multi ? [] : null);
    return (
      <View style={styles.section}>
        <Text style={styles.questionNum}>Question {questionIndex + 1} of {QUESTIONS.length}</Text>
        <Text style={styles.question}>{currentQuestion.text}</Text>
        {currentQuestion.options.map((option) => {
          const isSelected = currentQuestion.multi
            ? selected.includes(option)
            : selected === option;
          return (
            <TouchableOpacity
              key={option}
              style={[styles.option, isSelected && styles.optionSelected]}
              onPress={() => handleAnswer(currentQuestion.id, option, currentQuestion.multi)}
            >
              <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                {option}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {step > 0 && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${(step / (totalSteps - 1)) * 100}%` }]} />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {renderStep()}
      </ScrollView>

      <View style={styles.footer}>
        {step > 0 && (
          <TouchableOpacity style={styles.backBtn} onPress={() => setStep((current) => current - 1)}>
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.nextBtn, !canProceed() && styles.nextBtnDisabled]}
          onPress={handleNext}
          disabled={!canProceed()}
        >
          <Text style={styles.nextBtnText}>
            {step === totalSteps - 1 ? 'Get Started' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flexGrow: 1, padding: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  logo: { fontSize: 48, fontWeight: '800', color: COLORS.primary, marginBottom: 8 },
  tagline: { fontSize: 22, color: COLORS.text, fontWeight: '700', textAlign: 'center' },
  subText: { fontSize: 15, color: COLORS.textSecondary, textAlign: 'center', marginTop: 16, lineHeight: 22 },
  section: { paddingTop: 20 },
  question: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 24, lineHeight: 30 },
  questionNum: { fontSize: 13, color: COLORS.muted, marginBottom: 8 },
  helperText: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 16, lineHeight: 22 },
  option: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionSelected: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}22` },
  optionText: { fontSize: 16, color: COLORS.text, fontWeight: '600' },
  optionTextSelected: { color: COLORS.primary },
  optionMeta: { fontSize: 13, color: COLORS.textSecondary, marginTop: 6 },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    color: COLORS.text,
    borderWidth: 2,
    borderColor: COLORS.muted,
  },
  progressBar: {
    height: 4,
    backgroundColor: COLORS.surface,
    marginHorizontal: 24,
    marginTop: 16,
    borderRadius: 2,
  },
  progressFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 2 },
  footer: { flexDirection: 'row', padding: 24, gap: 12 },
  backBtn: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.muted,
    alignItems: 'center',
  },
  backBtnText: { color: COLORS.textSecondary, fontSize: 16, fontWeight: '600' },
  nextBtn: { flex: 2, backgroundColor: COLORS.primary, padding: 16, borderRadius: 12, alignItems: 'center' },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
