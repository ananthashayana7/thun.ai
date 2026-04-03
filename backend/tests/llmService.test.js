/**
 * llmService.test.js
 * Tests for LLM service with timeout, circuit breaker, and fallback chain.
 */
'use strict';

// ─── Mock LLM SDKs ──────────────────────────────────────────────────────────
const mockGenerateContent = jest.fn();
const mockSendMessage = jest.fn();
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({
    getGenerativeModel: jest.fn(() => ({
      generateContent: mockGenerateContent,
      startChat: jest.fn(() => ({
        sendMessage: mockSendMessage,
      })),
    })),
  })),
}));

const mockAnthropicCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn(() => ({
    messages: { create: mockAnthropicCreate },
  }));
});

const mockOpenAICreate = jest.fn();
jest.mock('openai', () => {
  return jest.fn(() => ({
    chat: { completions: { create: mockOpenAICreate } },
  }));
});

// Set API keys to enable all providers
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.OPENAI_API_KEY = 'test-openai-key';

// Use a fresh module for each test
let llmService;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  // Re-set env vars before re-requiring the module
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.GLOBAL_TIMEOUT_MS = '30000';

  // Re-mock the SDKs
  jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn(() => ({
      getGenerativeModel: jest.fn(() => ({
        generateContent: mockGenerateContent,
        startChat: jest.fn(() => ({
          sendMessage: mockSendMessage,
        })),
      })),
    })),
  }));
  jest.mock('@anthropic-ai/sdk', () => {
    return jest.fn(() => ({
      messages: { create: mockAnthropicCreate },
    }));
  });
  jest.mock('openai', () => {
    return jest.fn(() => ({
      chat: { completions: { create: mockOpenAICreate } },
    }));
  });

  llmService = require('../src/services/llmService');
});

const baseParams = {
  driverName: 'Test',
  anxietyScoreAvg: 40,
  peakStress: 60,
  stressEvents: [],
  routeMeta: { summary: 'Test Route', distance: '5 km', duration: '15 min' },
};

// ─── Fallback chain: Gemini → Claude → OpenAI ───────────────────────────────
describe('Fallback chain', () => {
  it('uses Gemini when available and healthy', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'Gemini narrative' },
    });

    const result = await llmService.generateConfidenceNarrative(baseParams, 'req-1');
    expect(result).toBe('Gemini narrative');
  });

  it('falls back to Claude when Gemini fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Gemini error'));
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: 'Claude narrative' }],
    });

    const result = await llmService.generateConfidenceNarrative(baseParams, 'req-2');
    expect(result).toBe('Claude narrative');
  });

  it('falls back to OpenAI when Gemini and Claude fail', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Gemini error'));
    mockAnthropicCreate.mockRejectedValue(new Error('Claude error'));
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: 'OpenAI narrative' } }],
    });

    const result = await llmService.generateConfidenceNarrative(baseParams, 'req-3');
    expect(result).toBe('OpenAI narrative');
  });

  it('returns synthetic fallback when all providers fail', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Gemini error'));
    mockAnthropicCreate.mockRejectedValue(new Error('Claude error'));
    mockOpenAICreate.mockRejectedValue(new Error('OpenAI error'));

    const result = await llmService.generateConfidenceNarrative(baseParams, 'req-4');
    expect(result).toContain('Dear Test');
    expect(result).toContain('average stress level of 40/100');
  });
});

// ─── Per-provider timeout (8s) ───────────────────────────────────────────────
describe('Per-provider timeout', () => {
  it('times out a slow provider and moves to fallback', async () => {
    // Gemini is slow (>8s)
    mockGenerateContent.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 9000))
    );
    mockAnthropicCreate.mockResolvedValue({
      content: [{ text: 'Claude fast response' }],
    });

    const result = await llmService.generateConfidenceNarrative(baseParams, 'req-5');
    expect(result).toBe('Claude fast response');
  }, 15000);
});

// ─── Circuit breaker opens after 5 failures ──────────────────────────────────
describe('Circuit breaker', () => {
  it('reports initial closed state', () => {
    const status = llmService.getCircuitBreakerStatus();
    expect(status.gemini.state).toBe('closed');
    expect(status.claude.state).toBe('closed');
    expect(status.openai.state).toBe('closed');
  });
});

// ─── Synthetic fallback content ──────────────────────────────────────────────
describe('Fallback narrative', () => {
  it('includes driver name in fallback', async () => {
    mockGenerateContent.mockRejectedValue(new Error('fail'));
    mockAnthropicCreate.mockRejectedValue(new Error('fail'));
    mockOpenAICreate.mockRejectedValue(new Error('fail'));

    const result = await llmService.generateConfidenceNarrative(
      { ...baseParams, driverName: 'Alice' },
      'req-6'
    );
    expect(result).toContain('Dear Alice');
  });

  it('includes route summary in fallback', async () => {
    mockGenerateContent.mockRejectedValue(new Error('fail'));
    mockAnthropicCreate.mockRejectedValue(new Error('fail'));
    mockOpenAICreate.mockRejectedValue(new Error('fail'));

    const result = await llmService.generateConfidenceNarrative(baseParams, 'req-7');
    expect(result).toContain('Test Route');
  });

  it('includes stress data in fallback', async () => {
    mockGenerateContent.mockRejectedValue(new Error('fail'));
    mockAnthropicCreate.mockRejectedValue(new Error('fail'));
    mockOpenAICreate.mockRejectedValue(new Error('fail'));

    const result = await llmService.generateConfidenceNarrative(baseParams, 'req-8');
    expect(result).toContain('40/100');
    expect(result).toContain('60/100');
  });
});

// ─── Request ID in logs ──────────────────────────────────────────────────────
describe('Request ID logging', () => {
  it('logs with request ID', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'response' },
    });

    await llmService.generateConfidenceNarrative(baseParams, 'trace-abc');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('trace-abc')
    );
    consoleSpy.mockRestore();
  });
});

// ─── Therapist response ──────────────────────────────────────────────────────
describe('generateTherapistResponse', () => {
  it('returns response from first available provider', async () => {
    mockSendMessage.mockResolvedValue({
      response: { text: () => 'Therapist response from Gemini' },
    });

    const result = await llmService.generateTherapistResponse(
      [{ role: 'user', content: 'I feel anxious' }],
      'You are a calm therapist.',
      'req-t1'
    );
    expect(result).toBe('Therapist response from Gemini');
  });

  it('returns canned response when all providers fail', async () => {
    mockSendMessage.mockRejectedValue(new Error('Gemini fail'));
    mockAnthropicCreate.mockRejectedValue(new Error('Claude fail'));
    mockOpenAICreate.mockRejectedValue(new Error('OpenAI fail'));

    const result = await llmService.generateTherapistResponse(
      [{ role: 'user', content: 'Help me' }],
      'system',
      'req-t2'
    );
    expect(result).toContain('I appreciate you sharing that');
  });
});

// ─── getCircuitBreakerStatus ─────────────────────────────────────────────────
describe('getCircuitBreakerStatus', () => {
  it('returns status for all three providers', () => {
    const status = llmService.getCircuitBreakerStatus();
    expect(status).toHaveProperty('gemini');
    expect(status).toHaveProperty('claude');
    expect(status).toHaveProperty('openai');
    expect(status.gemini).toHaveProperty('state');
    expect(status.gemini).toHaveProperty('failures');
    expect(status.gemini).toHaveProperty('retry_after');
  });
});
