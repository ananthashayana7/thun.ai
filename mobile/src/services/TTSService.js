/**
 * TTSService.js
 * Text-to-speech with Sarvam AI as primary (Indian language support)
 * and react-native-tts as offline fallback.
 *
 * Speed gate enforced here: mute voice when speed > 60 km/h.
 */
import axios from 'axios';
import Tts from 'react-native-tts';
import { SPEED_GATE_KMH } from '../utils/constants';

const SARVAM_URL = process.env.SARVAM_API_URL || 'https://api.sarvam.ai/text-to-speech';

// Language code mapping for Sarvam AI
const SARVAM_LANG_MAP = {
  'en-IN': 'en-IN',
  'hi-IN': 'hi-IN',
  'ta-IN': 'ta-IN',
  'te-IN': 'te-IN',
  'kn-IN': 'kn-IN',
  'ml-IN': 'ml-IN',
  'mr-IN': 'mr-IN',
  'bn-IN': 'bn-IN',
};

class TTSService {
  constructor() {
    this._currentSpeed = 0;
    this._language = 'en-IN';
    this._sarvamKey = null;
    this._queue = [];
    this._isSpeaking = false;

    Tts.setDefaultLanguage('en-IN');
    Tts.addEventListener('tts-finish', () => this._processQueue());
  }

  init(sarvamApiKey, language = 'en-IN') {
    this._sarvamKey = sarvamApiKey;
    this._language = language;
    Tts.setDefaultLanguage(language);
  }

  /** Update current vehicle speed (enforces speed gate) */
  setSpeed(speedKmh) {
    this._currentSpeed = speedKmh;
  }

  /**
   * Speak text. Silently dropped if speed > SPEED_GATE_KMH.
   * @param {string} text
   * @param {object} opts - { priority: 'high' | 'normal', language }
   */
  async speak(text, opts = {}) {
    if (this._currentSpeed > SPEED_GATE_KMH) {
      return; // speed gate: mute voice above 60 km/h
    }
    if (!text?.trim()) return;

    if (opts.priority === 'high') {
      await this._stop();
      this._queue = [{ text, opts }]; // replace queue with priority message
    } else {
      this._queue.push({ text, opts });
    }

    if (!this._isSpeaking) {
      this._processQueue();
    }
  }

  async _processQueue() {
    if (this._queue.length === 0) {
      this._isSpeaking = false;
      return;
    }
    const { text, opts } = this._queue.shift();
    this._isSpeaking = true;

    const lang = opts.language || this._language;

    try {
      if (this._sarvamKey) {
        await this._speakSarvam(text, lang);
      } else {
        throw new Error('No Sarvam key');
      }
    } catch (err) {
      console.warn('[TTSService] Sarvam failed, using native TTS:', err.message);
      this._speakNative(text, lang);
    }
  }

  async _speakSarvam(text, lang) {
    const response = await axios.post(
      SARVAM_URL,
      {
        inputs: [text],
        target_language_code: SARVAM_LANG_MAP[lang] || 'en-IN',
        speaker: 'meera',
        pitch: 0,
        pace: 1.0,
        loudness: 1.5,
        speech_sample_rate: 8000,
        enable_preprocessing: true,
        model: 'bulbul:v1',
      },
      {
        headers: {
          'api-subscription-key': this._sarvamKey,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
        responseType: 'json',
      }
    );

    const audioBase64 = response.data?.audios?.[0];
    if (!audioBase64) throw new Error('No audio in Sarvam response');

    // Play base64 audio using react-native-sound or similar
    // For now, fall through to native TTS as audio playback requires additional setup
    this._speakNative(text, lang);
  }

  _speakNative(text, lang) {
    Tts.setDefaultLanguage(lang);
    Tts.speak(text);
  }

  async _stop() {
    await Tts.stop();
    this._isSpeaking = false;
  }

  stopAll() {
    this._queue = [];
    this._stop();
  }
}

export default new TTSService();
