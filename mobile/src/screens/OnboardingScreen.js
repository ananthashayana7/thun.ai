/**
 * OnboardingScreen.js
 * Anxiety profiling onboarding – GAD-7 inspired driving-specific questionnaire.
 * Collects user name, preferred language, and anxiety levels.
 * Saves profile to Zustand store (persisted via SQLite).
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, SafeAreaView, Alert,
} from 'react-native';
import { useAnxietyProfileStore } from '../store/anxietyProfile';
import { COLORS } from '../utils/constants';

const QUESTIONS = [
  {
    id: 'q1',
    text: 'How often do you feel nervous or anxious while driving?',
    options: ['Never', 'Sometimes', 'Often', 'Almost always'],
  },
  {
    id: 'q2',
    text: 'Which driving situations stress you most?',
    options: ['Highway merges', 'Heavy traffic', 'Night driving', 'Narrow roads'],
    multi: true,
  },
  {
    id: 'q3',
    text: 'How do you usually respond when stressed while driving?',
    options: ['Brake suddenly', 'Speed up', 'Freeze / hesitate', 'Stay calm'],
  },
  {
    id: 'q4',
    text: 'Have you ever pulled over due to driving anxiety?',
    options: ['Yes, frequently', 'Yes, occasionally', 'Rarely', 'Never'],
  },
  {
    id: 'q5',
    text: 'What type of support do you prefer while driving?',
    options: ['Voice guidance', 'Visual cues only', 'Both', 'Minimal intervention'],
  },
];

const LANGUAGES = [
  { label: 'English', value: 'en-IN' },
  { label: 'हिन्दी', value: 'hi-IN' },
  { label: 'தமிழ்', value: 'ta-IN' },
  { label: 'తెలుగు', value: 'te-IN' },
  { label: 'ಕನ್ನಡ', value: 'kn-IN' },
  { label: 'മലയാളം', value: 'ml-IN' },
];

export default function OnboardingScreen({ navigation }) {
  const { updateProfile } = useAnxietyProfileStore();
  const [step, setStep] = useState(0); // 0=welcome, 1=name, 2=language, 3+=questions
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en-IN');
  const [answers, setAnswers] = useState({});

  const totalSteps = 3 + QUESTIONS.length;
  const questionIndex = step - 3;
  const currentQuestion = QUESTIONS[questionIndex];

  const handleAnswer = (qId, value, multi) => {
    if (multi) {
      const prev = answers[qId] || [];
      setAnswers((a) => ({
        ...a,
        [qId]: prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
      }));
    } else {
      setAnswers((a) => ({ ...a, [qId]: value }));
    }
  };

  const handleNext = async () => {
    if (step < totalSteps - 1) {
      setStep((s) => s + 1);
    } else {
      await completeOnboarding();
    }
  };

  const completeOnboarding = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter your name to continue.');
      setStep(1);
      return;
    }
    await updateProfile({
      onboardingComplete: true,
      name: name.trim(),
      ttsLanguage: language,
      questionnaire: answers,
      // Calibrate initial thresholds based on anxiety level reported
      thresholds: deriveThresholds(answers),
    });
    navigation.replace('Main');
  };

  function deriveThresholds(ans) {
    // q1: frequency of anxiety → lower trigger threshold for more anxious users
    const freq = ['Never', 'Sometimes', 'Often', 'Almost always'].indexOf(ans.q1 ?? 'Sometimes');
    const stressIndexTrigger = Math.max(40, 65 - freq * 8);
    return { stressIndexTrigger };
  }

  const renderStep = () => {
    if (step === 0) {
      return (
        <View style={styles.center}>
          <Text style={styles.logo}>thun.ai</Text>
          <Text style={styles.tagline}>Your calm co-pilot on every journey</Text>
          <Text style={styles.subText}>
            We'll ask a few quick questions to personalise your driving experience.
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
    // Questions
    if (currentQuestion) {
      const selected = answers[currentQuestion.id] || (currentQuestion.multi ? [] : null);
      return (
        <View style={styles.section}>
          <Text style={styles.questionNum}>Question {questionIndex + 1} of {QUESTIONS.length}</Text>
          <Text style={styles.question}>{currentQuestion.text}</Text>
          {currentQuestion.options.map((opt) => {
            const isSelected = currentQuestion.multi
              ? selected.includes(opt)
              : selected === opt;
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.option, isSelected && styles.optionSelected]}
                onPress={() => handleAnswer(currentQuestion.id, opt, currentQuestion.multi)}
              >
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }
    return null;
  };

  const canProceed = () => {
    if (step === 1 && !name.trim()) return false;
    if (step >= 3 && currentQuestion && !currentQuestion.multi) {
      if (!answers[currentQuestion.id]) return false;
    }
    return true;
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Progress bar */}
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
          <TouchableOpacity style={styles.backBtn} onPress={() => setStep((s) => s - 1)}>
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
  tagline: { fontSize: 20, color: COLORS.text, fontWeight: '600', textAlign: 'center' },
  subText: { fontSize: 15, color: COLORS.textSecondary, textAlign: 'center', marginTop: 16, lineHeight: 22 },
  section: { paddingTop: 20 },
  question: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 24, lineHeight: 30 },
  questionNum: { fontSize: 13, color: COLORS.muted, marginBottom: 8 },
  option: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionSelected: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}22` },
  optionText: { fontSize: 16, color: COLORS.text },
  optionTextSelected: { color: COLORS.primary, fontWeight: '600' },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    color: COLORS.text,
    borderWidth: 2,
    borderColor: COLORS.muted,
  },
  progressBar: { height: 4, backgroundColor: COLORS.surface, marginHorizontal: 24, marginTop: 16, borderRadius: 2 },
  progressFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 2 },
  footer: { flexDirection: 'row', padding: 24, gap: 12 },
  backBtn: { flex: 1, padding: 16, borderRadius: 12, borderWidth: 2, borderColor: COLORS.muted, alignItems: 'center' },
  backBtnText: { color: COLORS.textSecondary, fontSize: 16, fontWeight: '600' },
  nextBtn: { flex: 2, backgroundColor: COLORS.primary, padding: 16, borderRadius: 12, alignItems: 'center' },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
