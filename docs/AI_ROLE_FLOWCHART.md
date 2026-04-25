# AI Role Flowchart in thun.ai

This diagram summarizes how AI is used across the core Thun.AI system.

```mermaid
flowchart TD
    A[Start / Config Load]
    A --> B[Initialize Providers]
    B --> B1[SLM provider (on-device)]
    B --> B2[LLM provider (cloud)]
    B --> B3[VLM provider (vision)]
    B --> B4[Voice / TTS provider]
    B --> B5[Perception / Object Detector]
    
    subgraph Real-Time IVIS
      direction LR
      I1[OBD + Biometrics + Camera Frame] --> I2[Perception / Vision]
      I2 --> I3[IVIS Event Detection]
      I3 --> I4[Prompt Builder for Calm Intervention]
      I4 --> I5[SLM Generate Response]
      I5 --> I6[Voice TTS Speak]
      I3 --> I7[Stress History + Intervention Count]
    end
    
    subgraph Parked AI Therapist
      direction TB
      T1[Driver requests therapist / car parked] --> T2[LLM Conversation History]
      T2 --> T3[LLM Generate Therapist Response]
      T3 --> T4[Voice TTS Speak]
    end
    
    subgraph Post-Drive Feedback
      direction TB
      P1[Drive Summary + Stress Events] --> P2[Select LLM Flash or Pro]
      P2 --> P3[Generate Feedback Report]
      P3 --> P4[Return Report + Export Synthetic Data]
    end
    
    A --> Real-Time IVIS
    A --> Parked AI Therapist
    A --> Post-Drive Feedback
    
    style Real-Time IVIS stroke:#1f77b4,stroke-width:2px
    style Parked AI Therapist stroke:#2ca02c,stroke-width:2px
    style Post-Drive Feedback stroke:#d62728,stroke-width:2px

    click B1 href "src/thunai/intelligence/slm/ollama.py"
    click B2 href "src/thunai/intelligence/llm/"
    click B3 href "src/thunai/intelligence/vlm/"
    click B4 href "src/thunai/interaction/"
    click B5 href "src/thunai/perception/"
```

## AI role summary

- **SLM (Small Language Model)**: used in `src/thunai/features/ivis.py` for real-time, low-latency driving interventions. The SLM is typically local/on-device via Ollama or device-native Phi-3/Mistral.
- **LLM (Large Language Model)**: used for `AI Therapist` and `Post-Drive Feedback` in `src/thunai/features/therapist.py` and `src/thunai/features/post_drive.py`. It may use cloud providers like Gemini or OpenAI.
- **VLM (Vision LLM)**: optionally used in perception to analyze camera frames and enrich situational awareness.
- **Voice / TTS**: converts generated responses into spoken guidance or coach-style output.

## Key AI pathways

1. **Driving-time interventions**
   - Sensor data enters the IVIS loop
   - Stressful events are detected
   - The SLM generates a calm instruction
   - The voice engine speaks it back to the driver

2. **Parked therapist support**
   - Activated only when the car is stationary
   - Conversational messages are sent to the LLM
   - The LLM returns therapeutic coaching responses

3. **Post-drive feedback and training data**
   - The completed drive summary is sent to the LLM
   - A personalized feedback report is generated
   - Synthetic scenarios can be created for future model training
