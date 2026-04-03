/**
 * TherapistScreen.js
 * AI Driving Therapist – available ONLY when vehicle is stationary (RPM = 0).
 * Provides conversational CBT-based coaching for driving anxiety.
 * Voice-first with text fallback.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import TTSService from '../services/TTSService';
import IVISEngine from '../services/IVISEngine';
import SyncService from '../services/SyncService';
import { useAnxietyProfileStore } from '../store/anxietyProfile';
import { COLORS, API } from '../utils/constants';

const SYSTEM_CONTEXT = `You are a calm, empathetic AI driving therapist.
Your role is to help drivers manage driving anxiety using evidence-based CBT techniques.
Keep responses concise (2-3 sentences max), warm, and actionable.
Never recommend avoiding driving entirely. Focus on gradual exposure and confidence building.`;

const STARTER_PROMPTS = [
  'I feel anxious about highway driving',
  "I panic when trucks are close",
  "I froze at a junction today",
  "How can I stay calm in heavy traffic?",
];

export default function TherapistScreen({ navigation }) {
  const { profile } = useAnxietyProfileStore();
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Hello ${profile?.name || 'there'}! I'm your driving therapist. I'm here to help you build confidence behind the wheel. What's on your mind today?`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(true);
  const scrollRef = useRef(null);
  const pendingSubscriptions = useRef(new Map());

  // Check if vehicle is stationary (therapist only active at RPM=0)
  useEffect(() => {
    const timer = setInterval(() => {
      const isStationary = IVISEngine.isTherapistAvailable();
      setAvailable(isStationary);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => {
    pendingSubscriptions.current.forEach((unsubscribe) => unsubscribe());
    pendingSubscriptions.current.clear();
  }, []);

  const attachDeferredResponseListener = (requestKey) => {
    const unsubscribe = SyncService.subscribe(requestKey, async (event) => {
      if (event.status === 'completed') {
        const assistantText = event.data?.response;
        if (assistantText) {
          setMessages((currentMessages) => currentMessages.map((message) => (
            message.pendingKey === requestKey
              ? { role: 'assistant', content: assistantText }
              : message
          )));
          await TTSService.speak(assistantText, { priority: 'normal' });
        }
        pendingSubscriptions.current.get(requestKey)?.();
        pendingSubscriptions.current.delete(requestKey);
      }

      if (event.status === 'failed') {
        setMessages((currentMessages) => currentMessages.map((message) => (
          message.pendingKey === requestKey
            ? { role: 'assistant', content: "I'm still unable to connect. Please try again when the network is stable." }
            : message
        )));
        pendingSubscriptions.current.get(requestKey)?.();
        pendingSubscriptions.current.delete(requestKey);
      }
    });

    pendingSubscriptions.current.set(requestKey, unsubscribe);
  };

  const sendMessage = async (text = input.trim()) => {
    if (!text || loading) return;
    if (!available) {
      Alert.alert('Not available while driving', 'The AI Therapist is only available when your vehicle is stationary.');
      return;
    }

    const userMsg = { role: 'user', content: text };
    const updatedMessages = [...messages, userMsg];
    const requestKey = `feedback.therapist.${Date.now()}`;
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);
    attachDeferredResponseListener(requestKey);

    try {
      const result = await SyncService.request({
        requestKey,
        method: 'POST',
        url: `${API.BASE_URL}/feedback/therapist`,
        body: {
          messages: updatedMessages.slice(-10), // last 10 for context
          systemContext: SYSTEM_CONTEXT,
          driverProfile: {
            name: profile?.name,
            questionnaire: profile?.questionnaire,
          },
        },
        timeout: 30_000,
        queueIfOffline: true,
      });

      if (result.status === 'success') {
        const assistantText = result.data?.response;
        if (assistantText) {
          pendingSubscriptions.current.get(requestKey)?.();
          pendingSubscriptions.current.delete(requestKey);
          setMessages((m) => [...m, { role: 'assistant', content: assistantText }]);
        // Speak the response (speed gate applies – but therapist is stationary only anyway)
          await TTSService.speak(assistantText, { priority: 'normal' });
        }
      } else if (result.status === 'queued') {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: "I'm offline right now. I saved your message and will answer automatically when the connection returns.",
            pendingKey: requestKey,
          },
        ]);
      }
    } catch (err) {
      pendingSubscriptions.current.get(requestKey)?.();
      pendingSubscriptions.current.delete(requestKey);
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: "I'm having trouble connecting right now. Please try again in a moment." },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>🧠 AI Driving Therapist</Text>
          <View style={[styles.statusDot, { backgroundColor: available ? COLORS.accent : COLORS.danger }]} />
        </View>
        {!available && (
          <View style={styles.unavailableBanner}>
            <Text style={styles.unavailableText}>🚗 Only available when stationary</Text>
          </View>
        )}

        {/* Conversation */}
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.map((msg, i) => (
            <View
              key={i}
              style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble]}
            >
              <Text style={[styles.bubbleText, msg.role === 'user' ? styles.userText : styles.aiText]}>
                {msg.content}
              </Text>
            </View>
          ))}
          {loading && (
            <View style={styles.aiBubble}>
              <Text style={styles.aiText}>Thinking…</Text>
            </View>
          )}
        </ScrollView>

        {/* Starter prompts */}
        {messages.length <= 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.starters} contentContainerStyle={styles.startersContent}>
            {STARTER_PROMPTS.map((p) => (
              <TouchableOpacity key={p} style={styles.starterChip} onPress={() => sendMessage(p)}>
                <Text style={styles.starterChipText}>{p}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Input */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Talk to your therapist…"
            placeholderTextColor={COLORS.muted}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
            onPress={() => sendMessage()}
            disabled={!input.trim() || loading}
          >
            <Text style={styles.sendBtnText}>→</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.text },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  unavailableBanner: { backgroundColor: `${COLORS.warning}22`, padding: 10, marginHorizontal: 20, borderRadius: 8, marginBottom: 8 },
  unavailableText: { color: COLORS.warning, fontSize: 13, textAlign: 'center' },
  messages: { flex: 1 },
  messagesContent: { padding: 20, gap: 10 },
  bubble: { maxWidth: '80%', borderRadius: 16, padding: 14 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: COLORS.primary },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: COLORS.surface },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  userText: { color: '#fff' },
  aiText: { color: COLORS.text },
  starters: { maxHeight: 60 },
  startersContent: { paddingHorizontal: 20, gap: 8 },
  starterChip: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.muted,
  },
  starterChipText: { color: COLORS.textSecondary, fontSize: 13 },
  inputRow: { flexDirection: 'row', padding: 16, gap: 10, alignItems: 'flex-end' },
  textInput: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 16,
    padding: 12, color: COLORS.text, fontSize: 15, maxHeight: 120,
    borderWidth: 1, borderColor: COLORS.muted,
  },
  sendBtn: { backgroundColor: COLORS.primary, borderRadius: 12, width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});
