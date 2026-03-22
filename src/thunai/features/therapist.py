"""
Feature 3: AI Therapist.

Activated only when the user explicitly requests it AND the vehicle RPM is 0
(car safely parked).

Provides:
  - Guided breathing exercise
  - Calm, CBT-aligned reassurance from the LLM (Pro model)
  - Roadside recovery protocol
"""

from __future__ import annotations

import logging
import time

from thunai.config import TherapistConfig
from thunai.intelligence.base import BaseLLMProvider, LLMProvider, Message
from thunai.interaction import VoiceEngine
from thunai.interaction.base import TTSProvider
from thunai.models import UserProfile

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are a calm, warm, and professional driving therapist.
Your role is to help drivers who are experiencing anxiety while driving.
Always speak in short, clear sentences. Use a reassuring and non-judgmental tone.
Never suggest the driver is incompetent. Focus on breathing, grounding techniques,
and small actionable steps. Your responses must be under 100 words."""

# Limit retained turns to avoid unbounded memory use during long sessions.
# System prompt is always kept; this caps the number of user+assistant turns.
_MAX_HISTORY_TURNS = 20

_BREATHING_SCRIPT = [
    "Let's take a moment together.",
    "Breathe in slowly through your nose… two… three… four.",
    "Hold gently… two… three… four.",
    "Now breathe out through your mouth… two… three… four… five… six.",
    "Wonderful. Once more.",
    "Breathe in… two… three… four.",
    "Hold… two… three… four.",
    "Breathe out… two… three… four… five… six.",
    "You are safe. The car is parked. Take your time.",
]


class AITherapist:
    """
    AI Therapist — roadside recovery and calm reinforcement.

    Safety contract: the therapist will ONLY activate when:
      1. The user explicitly requests activation.
      2. The vehicle RPM is confirmed to be 0 (engine off or idling in park).
    """

    def __init__(
        self,
        config: TherapistConfig,
        llm: BaseLLMProvider,
        voice: VoiceEngine,
    ) -> None:
        self._config = config
        self._llm = llm
        self._voice = voice
        self._session_history: list[Message] = []

    def activate(self, rpm: int, user_requested: bool) -> bool:
        """
        Attempt to activate the therapist.

        Returns ``True`` if activation succeeded, ``False`` otherwise.
        """
        if self._config.require_user_request and not user_requested:
            logger.debug("Therapist not activated: user has not requested it.")
            return False

        if rpm != 0:
            logger.info("Therapist not activated: vehicle RPM is %d (must be 0).", rpm)
            self._voice.speak("Please pull over safely and park the car before we begin.")
            return False

        logger.info("AI Therapist activated.")
        self._session_history = [Message(role="system", content=_SYSTEM_PROMPT)]
        return True

    def run_breathing_exercise(self) -> None:
        """Guide the driver through a breathing exercise."""
        for line in _BREATHING_SCRIPT:
            self._voice.speak(line)
            time.sleep(4)  # Pause between instructions

    def respond(self, user_message: str) -> str:
        """
        Generate a therapist response to the driver's message.

        Maintains conversation history for contextual responses.
        History is trimmed to the last ``_MAX_HISTORY_TURNS`` turns so
        that the session cannot consume unbounded memory.
        """
        self._session_history.append(Message(role="user", content=user_message))

        # Keep system prompt + at most _MAX_HISTORY_TURNS recent messages.
        if len(self._session_history) > _MAX_HISTORY_TURNS + 1:
            self._session_history = [
                self._session_history[0],  # system prompt always retained
                *self._session_history[-_MAX_HISTORY_TURNS:],
            ]

        response = self._llm.generate(self._session_history)
        self._session_history.append(Message(role="assistant", content=response.text))
        self._voice.speak(response.text)
        logger.info("Therapist response: %s", response.text[:80])
        return response.text

    def roadside_recovery(self) -> None:
        """
        Full roadside recovery protocol.

        1. Confirm car is safely parked.
        2. Activate hazard lights reminder.
        3. Lead breathing exercise.
        4. Open conversation.
        """
        self._voice.speak(
            "I see you've pulled over. Make sure your hazard lights are on — "
            "the button is usually in the centre of your dashboard."
        )
        time.sleep(3)
        self._voice.speak("Now let's focus on your breathing together.")
        self.run_breathing_exercise()
        self._voice.speak(
            "Well done. Whenever you're ready to talk, I'm here. "
            "Just tell me how you're feeling."
        )


# Developer reference implementation (v1)
SYSTEM_PROMPT = """You are thun.ai's AI Driving Therapist.
You help drivers overcome anxiety using Cognitive Behavioural Therapy (CBT) techniques.
Your tone is calm, warm, and non-clinical. You never use jargon.
You only ever give one actionable suggestion per response.
If the driver is stationary and distressed, start with a breathing exercise.
Keep all responses under 60 words.
Never ask more than one question at a time.
"""


class AITherapistFeature:
    def __init__(self, cfg: dict, llm: LLMProvider, tts: TTSProvider):
        self.llm = llm
        self.tts = tts
        t_cfg = cfg["features"]["therapist"] if "features" in cfg else cfg
        self.timeout = t_cfg.get("session_timeout_s", 300)
        self.rpm_gate = t_cfg.get("resting_rpm_threshold", 100)
        self.history: list[dict] = []

    def respond(self, user_text: str, profile: UserProfile, rpm: float = 0.0) -> str:
        if rpm > self.rpm_gate:
            logger.warning("Therapist: blocked — vehicle moving (RPM=%.0f)", rpm)
            return ""
        personalised_system = (
            SYSTEM_PROMPT
            + f"\nThe driver has {profile.experience_months} months of experience."
            f" Anxiety areas: {profile.anxiety_score.dict()}."
        )
        self.history.append({"role": "user", "content": user_text})
        context = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in self.history[-6:])
        response = self.llm.complete(
            system=personalised_system,
            user=context,
            max_tokens=120,
            temperature=0.5,
        )
        self.history.append({"role": "assistant", "content": response})
        try:
            self.tts.synthesise(response)
        except Exception as e:
            logger.warning("Therapist TTS failed: %s", e)
        return response

    def reset_session(self) -> None:
        self.history.clear()
        logger.info("Therapist session reset.")
