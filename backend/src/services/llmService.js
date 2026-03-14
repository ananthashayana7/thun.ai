/**
 * llmService.js
 * LLM proxy – Anthropic Claude primary, OpenAI GPT-4o-mini fallback.
 * Generates:
 *   1. Confidence narrative (200–350 words)
 *   2. Synthetic scenario variants for stress events (severity > 3)
 *   3. Therapist chat responses
 */
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '30000', 10);
const NARRATIVE_MIN_WORDS = 200;
const NARRATIVE_MAX_WORDS = 350;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: LLM_TIMEOUT_MS });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: LLM_TIMEOUT_MS });

// ─── Confidence Narrative ─────────────────────────────────────────────────────

/**
 * Generate a personalised post-drive confidence narrative.
 * @param {object} params - { driverName, anxietyScoreAvg, peakStress, stressEvents, routeMeta }
 * @returns {string} narrative text
 */
async function generateConfidenceNarrative(params) {
  const prompt = buildNarrativePrompt(params);

  try {
    return await callClaude(prompt, 512);
  } catch (err) {
    console.warn('[LLM] Claude failed, trying OpenAI fallback:', err.message);
    return await callOpenAI(prompt, 512);
  }
}

function buildNarrativePrompt({ driverName, anxietyScoreAvg, peakStress, stressEvents, routeMeta }) {
  const eventSummary = stressEvents?.length > 0
    ? stressEvents.slice(0, 5).map((e) => `stress=${e.score} at ${e.speed}km/h`).join('; ')
    : 'none recorded';

  return `You are a compassionate driving confidence coach.
Write a personalised post-drive confidence narrative for ${driverName || 'the driver'}.

Drive data:
- Route: ${routeMeta?.summary || 'unknown route'} (${routeMeta?.distance || '?'}, ${routeMeta?.duration || '?'})
- Average stress index: ${anxietyScoreAvg}/100
- Peak stress: ${peakStress}/100
- Stress events: ${eventSummary}

Guidelines:
- Tone: warm, encouraging, evidence-based CBT framing
- Length: ${NARRATIVE_MIN_WORDS}–${NARRATIVE_MAX_WORDS} words
- Acknowledge specific challenges the driver faced
- Highlight what they did well
- Provide 1–2 actionable tips for next time
- End with a confidence-building affirmation
- Do NOT mention the word "anxiety" directly; use "nervous energy" or "driving stress"
- Do NOT recommend avoiding driving`;
}

// ─── Scenario Variants ────────────────────────────────────────────────────────

/**
 * Generate 10–20 synthetic practice scenarios for high-severity stress events.
 * @param {Array} stressEvents - events with severity >= 3
 * @param {object} driverProfile
 * @returns {Array<{title, suggestion}>}
 */
async function generateScenarioVariants(stressEvents, driverProfile) {
  const highSeverity = stressEvents.filter((e) => (e.score ?? 0) >= 75);
  if (highSeverity.length === 0) return [];

  const prompt = buildScenarioPrompt(highSeverity, driverProfile);

  let raw;
  try {
    raw = await callClaude(prompt, 1024);
  } catch (err) {
    console.warn('[LLM] Claude failed for scenarios, trying OpenAI:', err.message);
    raw = await callOpenAI(prompt, 1024);
  }

  return parseScenarioJSON(raw);
}

function buildScenarioPrompt(events, profile) {
  const eventDesc = events
    .slice(0, 5)
    .map((e, i) => `Event ${i + 1}: stress=${e.score}, speed=${e.speed}km/h, rpm=${e.rpm}`)
    .join('\n');

  return `You are a driving psychologist creating graduated exposure practice scenarios.

The driver experienced these high-stress moments:
${eventDesc}

Generate 10 to 15 synthetic practice scenarios that would help this driver build confidence through graduated exposure. Each scenario should be slightly less intense than the actual event.

Return ONLY valid JSON array with this structure:
[
  {
    "title": "Short scenario title (< 10 words)",
    "suggestion": "2-3 sentence actionable suggestion (CBT framing)"
  }
]

Rules:
- Progress from easy to challenging
- Reference specific driving situations (merging, speed, vehicle type)
- Never suggest avoidance
- Be specific and actionable`;
}

function parseScenarioJSON(raw) {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]).slice(0, 20);
  } catch {
    return [];
  }
}

// ─── Therapist Chat ───────────────────────────────────────────────────────────

/**
 * Generate a therapist chat response.
 * @param {Array} messages - [{role, content}] conversation history
 * @param {string} systemContext
 * @returns {string} assistant response
 */
async function generateTherapistResponse(messages, systemContext) {
  try {
    return await callClaudeMessages(messages, systemContext, 256);
  } catch (err) {
    console.warn('[LLM] Claude chat failed, trying OpenAI:', err.message);
    return await callOpenAIMessages(messages, systemContext, 256);
  }
}

// ─── LLM Client Wrappers ──────────────────────────────────────────────────────

async function callClaude(prompt, maxTokens) {
  const msg = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return msg.content[0]?.text ?? '';
}

async function callClaudeMessages(messages, system, maxTokens) {
  const msg = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: maxTokens,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return msg.content[0]?.text ?? '';
}

async function callOpenAI(prompt, maxTokens) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return completion.choices[0]?.message?.content ?? '';
}

async function callOpenAIMessages(messages, systemContent, maxTokens) {
  const msgs = [
    { role: 'system', content: systemContent },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: maxTokens,
    messages: msgs,
  });
  return completion.choices[0]?.message?.content ?? '';
}

module.exports = {
  generateConfidenceNarrative,
  generateScenarioVariants,
  generateTherapistResponse,
};
