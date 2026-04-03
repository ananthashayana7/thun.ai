/**
 * llmService.js
 * LLM proxy with global timeout, circuit breaker, and fallback chain.
 * Generates confidence narratives, scenario variants, and therapist responses.
 *
 * Global timeout: 30s total (8s per provider attempt + 6s buffer)
 * Fallback chain: Gemini → Claude → OpenAI
 * Circuit breaker: Skip provider after 5 consecutive failures for 5 min
 */
'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const GLOBAL_TIMEOUT_MS = parseInt(process.env.GLOBAL_TIMEOUT_MS || '30000', 10);
const PER_PROVIDER_TIMEOUT_MS = 8000;
const NARRATIVE_MIN_WORDS = 200;
const NARRATIVE_MAX_WORDS = 350;

// Circuit breaker state
const circuitBreaker = {
  gemini: { failures: 0, lastFailure: 0, isOpen: false },
  claude: { failures: 0, lastFailure: 0, isOpen: false },
  openai: { failures: 0, lastFailure: 0, isOpen: false },
};

const CIRCUIT_BREAKER_THRESHOLD = 5;          // failures before opening
const CIRCUIT_BREAKER_RESET_PERIOD = 5 * 60 * 1000;  // 5 minutes

const geminiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: PER_PROVIDER_TIMEOUT_MS });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: PER_PROVIDER_TIMEOUT_MS });

/**
 * Check and manage circuit breaker state.
 */
function checkCircuitBreaker(provider) {
  const breaker = circuitBreaker[provider];
  if (!breaker.isOpen) return false;

  // If reset period has passed, try to recover (half-open state)
  if (Date.now() - breaker.lastFailure > CIRCUIT_BREAKER_RESET_PERIOD) {
    console.log(`[CircuitBreaker] ${provider} attempting recovery (half-open)`);
    breaker.failures = 0;
    breaker.isOpen = false;
    return false;
  }

  console.warn(`[CircuitBreaker] ${provider} is OPEN, skipping request`);
  return true;
}

/**
 * Record LLM provider failure and update circuit breaker.
 */
function recordFailure(provider, error) {
  const breaker = circuitBreaker[provider];
  breaker.failures += 1;
  breaker.lastFailure = Date.now();

  if (breaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    breaker.isOpen = true;
    console.error(`[CircuitBreaker] ${provider} OPEN after ${breaker.failures} failures: ${error.message}`);
  } else {
    console.warn(`[CircuitBreaker] ${provider} failure ${breaker.failures}/${CIRCUIT_BREAKER_THRESHOLD}: ${error.message}`);
  }
}

/**
 * Record LLM provider success and reset circuit breaker.
 */
function recordSuccess(provider) {
  const breaker = circuitBreaker[provider];
  if (breaker.failures > 0) {
    console.log(`[CircuitBreaker] ${provider} recovered (failures reset)`);
  }
  breaker.failures = 0;
  breaker.isOpen = false;
}

/**
 * Generate a personalised post-drive confidence narrative with global timeout.
 * @param {object} params - { driverName, anxietyScoreAvg, peakStress, stressEvents, routeMeta }
 * @param {string} requestId - for logging correlation
 * @returns {string} narrative text
 */
async function generateConfidenceNarrative(params, requestId = 'unknown') {
  const prompt = buildNarrativePrompt(params);
  const startTime = Date.now();

  // Create global AbortController with 30s timeout
  const controller = new AbortController();
  const globalTimeoutHandle = setTimeout(() => {
    controller.abort();
  }, GLOBAL_TIMEOUT_MS);

  try {
    // Try Gemini (8s window)
    if (geminiClient && !checkCircuitBreaker('gemini')) {
      try {
        console.log(`[${requestId}] LLM: Trying Gemini for narrative`);
        const result = await withTimeout(
          callGemini(prompt, 1024, controller),
          PER_PROVIDER_TIMEOUT_MS,
          'Gemini'
        );
        recordSuccess('gemini');
        clearTimeout(globalTimeoutHandle);
        console.log(`[${requestId}] LLM: Gemini succeeded (${Date.now() - startTime}ms)`);
        return result;
      } catch (err) {
        recordFailure('gemini', err);
      }
    }

    // Try Claude (8s window)
    if (!checkCircuitBreaker('claude')) {
      try {
        console.log(`[${requestId}] LLM: Trying Claude for narrative`);
        const result = await withTimeout(
          callClaude(prompt, 512, controller),
          PER_PROVIDER_TIMEOUT_MS,
          'Claude'
        );
        recordSuccess('claude');
        clearTimeout(globalTimeoutHandle);
        console.log(`[${requestId}] LLM: Claude succeeded (${Date.now() - startTime}ms)`);
        return result;
      } catch (err) {
        recordFailure('claude', err);
      }
    }

    // Try OpenAI (final fallback, 8s window)
    if (!checkCircuitBreaker('openai')) {
      try {
        console.log(`[${requestId}] LLM: Trying OpenAI for narrative`);
        const result = await withTimeout(
          callOpenAI(prompt, 512, controller),
          PER_PROVIDER_TIMEOUT_MS,
          'OpenAI'
        );
        recordSuccess('openai');
        clearTimeout(globalTimeoutHandle);
        console.log(`[${requestId}] LLM: OpenAI succeeded (${Date.now() - startTime}ms)`);
        return result;
      } catch (err) {
        recordFailure('openai', err);
      }
    }

    // All providers failed or circuits open
    clearTimeout(globalTimeoutHandle);
    console.error(`[${requestId}] LLM: All providers failed or circuits open after ${Date.now() - startTime}ms`);
    return generateFallbackNarrative(params);
  } catch (err) {
    clearTimeout(globalTimeoutHandle);
    console.error(`[${requestId}] LLM: Global timeout or error:`, err.message);
    return generateFallbackNarrative(params);
  }
}

/**
 * Wrap a promise with a per-provider timeout.
 */
function withTimeout(promise, timeoutMs, providerName) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${providerName} timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * Generate a fallback narrative if all LLMs fail.
 */
function generateFallbackNarrative(params) {
  const { driverName, anxietyScoreAvg, peakStress, routeMeta } = params;
  return `Dear ${driverName || 'Driver'},

Thank you for completing this drive. Your session data shows an average stress level of ${anxietyScoreAvg}/100 with a peak of ${peakStress}/100 during your journey on ${routeMeta?.summary || 'your route'}.

Despite some challenging moments, you successfully completed the drive, which demonstrates your capability and resilience. Every drive is an opportunity to build confidence and develop new coping strategies.

For your next drive, focus on one small thing you did well today and try to replicate it. Small, consistent improvements build lasting confidence.

You're doing great. Keep driving safely.`;
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
async function generateScenarioVariants(stressEvents, _driverProfile) {
  const highSeverity = stressEvents.filter((e) => (e.score ?? 0) >= 75);
  if (highSeverity.length === 0) return [];

  const prompt = buildScenarioPrompt(highSeverity, _driverProfile);

  let raw;
  if (geminiClient) {
    try {
      raw = await callGemini(prompt, 2048);
    } catch (err) {
      console.warn('[LLM] Gemini failed for scenarios, trying Claude:', err.message);
    }
  }

  if (!raw) {
    try {
      raw = await callClaude(prompt, 1024);
    } catch (err) {
      console.warn('[LLM] Claude failed for scenarios, trying OpenAI:', err.message);
      raw = await callOpenAI(prompt, 1024);
    }
  }

  return parseScenarioJSON(raw);
}

function buildScenarioPrompt(events, _profile) {
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

/**
 * Generate a therapist chat response with global timeout.
 * @param {Array} messages - [{role, content}] conversation history
 * @param {string} systemContext
 * @param {string} requestId - for logging correlation
 * @returns {string} assistant response
 */
async function generateTherapistResponse(messages, systemContext, requestId = 'unknown') {
  const startTime = Date.now();
  const controller = new AbortController();
  const globalTimeoutHandle = setTimeout(() => {
    controller.abort();
  }, GLOBAL_TIMEOUT_MS);

  try {
    // Try Gemini
    if (geminiClient && !checkCircuitBreaker('gemini')) {
      try {
        console.log(`[${requestId}] LLM: Trying Gemini for therapist`);
        const result = await withTimeout(
          callGeminiMessages(messages, systemContext, controller),
          PER_PROVIDER_TIMEOUT_MS,
          'Gemini'
        );
        recordSuccess('gemini');
        clearTimeout(globalTimeoutHandle);
        console.log(`[${requestId}] LLM: Gemini succeeded (${Date.now() - startTime}ms)`);
        return result;
      } catch (err) {
        recordFailure('gemini', err);
      }
    }

    // Try Claude
    if (!checkCircuitBreaker('claude')) {
      try {
        console.log(`[${requestId}] LLM: Trying Claude for therapist`);
        const result = await withTimeout(
          callClaudeMessages(messages, systemContext, controller),
          PER_PROVIDER_TIMEOUT_MS,
          'Claude'
        );
        recordSuccess('claude');
        clearTimeout(globalTimeoutHandle);
        console.log(`[${requestId}] LLM: Claude succeeded (${Date.now() - startTime}ms)`);
        return result;
      } catch (err) {
        recordFailure('claude', err);
      }
    }

    // Try OpenAI
    if (!checkCircuitBreaker('openai')) {
      try {
        console.log(`[${requestId}] LLM: Trying OpenAI for therapist`);
        const result = await withTimeout(
          callOpenAIMessages(messages, systemContext, controller),
          PER_PROVIDER_TIMEOUT_MS,
          'OpenAI'
        );
        recordSuccess('openai');
        clearTimeout(globalTimeoutHandle);
        console.log(`[${requestId}] LLM: OpenAI succeeded (${Date.now() - startTime}ms)`);
        return result;
      } catch (err) {
        recordFailure('openai', err);
      }
    }

    clearTimeout(globalTimeoutHandle);
    console.error(`[${requestId}] LLM: All therapist providers failed after ${Date.now() - startTime}ms`);
    return 'I appreciate you sharing that. Let\'s take a moment to breathe together. When you\'re ready, tell me more about what you\'re experiencing.';
  } catch (err) {
    clearTimeout(globalTimeoutHandle);
    console.error(`[${requestId}] LLM: Therapist timeout or error:`, err.message);
    return 'I appreciate you sharing that. Let\'s take a moment to breathe together. When you\'re ready, tell me more about what you\'re experiencing.';
  }
}

/**
 * Call Gemini with conversation history.
 */
async function callGeminiMessages(messages, systemContext, controller) {
  if (!geminiClient) throw new Error('Gemini client not initialised');
  if (controller?.signal?.aborted) throw new Error('Request aborted (timeout)');

  const model = geminiClient.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemContext,
    generationConfig: { maxOutputTokens: 256, temperature: 0.4 },
  });

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage?.content) {
    throw new Error('callGeminiMessages: conversation must end with user message');
  }

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(lastMessage.content);
  return result.response.text();
}

/**
 * Call Claude with conversation history.
 */
async function callClaudeMessages(messages, system, controller) {
  if (controller?.signal?.aborted) throw new Error('Request aborted (timeout)');

  const msg = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 256,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return msg.content[0]?.text ?? '';
}

/**
 * Call OpenAI with conversation history.
 */
async function callOpenAIMessages(messages, systemContent, controller) {
  if (controller?.signal?.aborted) throw new Error('Request aborted (timeout)');

  const msgs = [
    { role: 'system', content: systemContent },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 256,
    messages: msgs,
  });
  return completion.choices[0]?.message?.content ?? '';
}

/**
 * Call Gemini with a single text prompt.
 * @param {string} prompt
 * @param {number} maxTokens
 * @param {AbortController} controller
 * @returns {Promise<string>}
 */
async function callGemini(prompt, maxTokens, controller) {
  if (!geminiClient) throw new Error('Gemini client not initialised (GEMINI_API_KEY not set)');
  
  if (controller?.signal?.aborted) throw new Error('Request aborted (timeout)');
  
  const model = geminiClient.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * Call Claude with a single text prompt.
 * @param {string} prompt
 * @param {number} maxTokens
 * @param {AbortController} controller
 * @returns {Promise<string>}
 */
async function callClaude(prompt, maxTokens, controller) {
  if (controller?.signal?.aborted) throw new Error('Request aborted (timeout)');
  
  const msg = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return msg.content[0]?.text ?? '';
}

/**
 * Call OpenAI with a single text prompt.
 * @param {string} prompt
 * @param {number} maxTokens
 * @param {AbortController} controller
 * @returns {Promise<string>}
 */
async function callOpenAI(prompt, maxTokens, controller) {
  if (controller?.signal?.aborted) throw new Error('Request aborted (timeout)');
  
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return completion.choices[0]?.message?.content ?? '';
}

function getCircuitBreakerStatus() {
  const status = {};
  for (const [provider, breaker] of Object.entries(circuitBreaker)) {
    const isActuallyOpen = breaker.isOpen && (Date.now() - breaker.lastFailure < CIRCUIT_BREAKER_RESET_PERIOD);
    status[provider] = {
      state: isActuallyOpen ? 'open' : (breaker.failures > 0 ? 'half-open' : 'closed'),
      failures: breaker.failures,
      retry_after: isActuallyOpen ? Math.ceil((CIRCUIT_BREAKER_RESET_PERIOD - (Date.now() - breaker.lastFailure)) / 1000) : 0
    };
  }
  return status;
}

module.exports = {
  generateConfidenceNarrative,
  generateScenarioVariants,
  generateTherapistResponse,
  getCircuitBreakerStatus,
};
