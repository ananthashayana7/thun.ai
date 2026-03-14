# thun.ai

**AI-Powered In-Vehicle Intelligence System (IVIS) for Driving Anxiety**

Closing the gap between licensing and freedom. thun.ai is an edge-first AI system designed specifically for the Indian road ecosystem. It integrates real-time sensor fusion with a Psychological Comfort Model to provide non-intrusive, calm, and confident driving interventions.

---

## Software Architecture

```
thun.ai/
├── config/
│   └── default.yaml          # All provider & feature configuration
├── src/thunai/
│   ├── config.py             # Config loader (YAML + env-var overrides)
│   ├── engine.py             # Main orchestrator
│   ├── cli.py                # Command-line interface
│   ├── intelligence/
│   │   ├── base.py           # Abstract interfaces (LLM, SLM, VLM)
│   │   ├── llm/              # Cloud LLMs: Gemini Flash/Pro, OpenAI
│   │   ├── slm/              # On-device SLMs: Phi-3, Mistral via Ollama
│   │   └── vlm/              # Vision LLMs: Gemini, LLaVA via Ollama
│   ├── perception/           # Object detection (YOLO / MobileNet / stub)
│   ├── interaction/          # Voice TTS (Sarvam AI / ElevenLabs / system)
│   └── features/
│       ├── pre_drive.py      # Peace-of-Mind route selection
│       ├── ivis.py           # Real-time IVIS intervention engine
│       ├── therapist.py      # AI Therapist (parked-only, user-activated)
│       └── post_drive.py     # Post-drive feedback & synthetic scenarios
└── tests/                    # 50 unit tests — all providers, all features
```

---

## Configuring LLMs and SLMs

All AI providers are configured in `config/default.yaml`. Switch providers with a single line or via environment variable — no code changes required.

### Switching LLM provider

**Config file:**
```yaml
llm:
  provider: gemini   # gemini | openai | stub
```

**Environment variable override:**
```bash
export THUNAI_LLM_PROVIDER=gemini
export GEMINI_API_KEY=your_key_here
```

### Switching on-device SLM provider

```yaml
slm:
  provider: ollama   # ollama | phi3 | mistral | stub
  ollama:
    model: phi3:mini
    base_url: http://localhost:11434
```

**With Ollama (recommended for development):**
```bash
# Install Ollama: https://ollama.ai
ollama serve
ollama pull phi3:mini
export THUNAI_SLM_PROVIDER=ollama
```

**With Phi-3 direct GGUF (on-device hardware):**
```bash
pip install llama-cpp-python
# Download model to models/local/phi-3-mini-4k-instruct.Q4_K_M.gguf
export THUNAI_SLM_PROVIDER=phi3
```

### Hardware ready? Plug in and check:
```bash
# Check all active providers
thunai status
```

---

## Quick Start

```bash
# Install
pip install -e ".[dev]"

# Run diagnostics
thunai status

# Run a simulated drive session (no API keys needed)
thunai demo
```

---

## Features

| Feature | Module | Description |
|---------|--------|-------------|
| **Pre-Drive** | `features/pre_drive.py` | Psychology-based route selection |
| **IVIS** | `features/ivis.py` | Real-time calm interventions |
| **AI Therapist** | `features/therapist.py` | Parked-only roadside recovery |
| **Post-Drive** | `features/post_drive.py` | LLM-generated feedback + synthetic scenarios |

---

## Provider Matrix

| Layer | Provider | When to use |
|-------|----------|-------------|
| **LLM** | `gemini` (default) | Post-drive feedback, therapist, synthetic data |
| **LLM** | `openai` | Alternative cloud option |
| **LLM** | `stub` | Development / CI without API keys |
| **SLM** | `ollama` (phi3:mini) | On-device dev (Ollama server) |
| **SLM** | `phi3` | Directly on Rockchip SoC / phone NPU |
| **SLM** | `mistral` | Alternative on-device model |
| **SLM** | `stub` | Development / CI |
| **VLM** | `gemini` | Cloud scene analysis |
| **VLM** | `ollama` (llava:7b) | On-device scene analysis |
| **VLM** | `stub` | Development / CI |
| **Voice** | `sarvam` | Indian-language TTS (production) |
| **Voice** | `elevenlabs` | High-quality TTS |
| **Voice** | `system` | OS TTS, no API key needed |
| **Voice** | `stub` | Console output (dev / CI) |

---

## Running Tests

```bash
pytest tests/ -v
```

All 50 tests run without any API keys. Providers without credentials gracefully fall back to stub implementations.

