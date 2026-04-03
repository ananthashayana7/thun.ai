# thun.ai Local Setup and Visualization (Windows)

This guide bootstraps the monorepo on Windows and gives architecture views you can keep in the repo.

## 1) Prerequisites

Required versions:
- Node.js 18+
- npm 9+
- Python 3.10+
- PostgreSQL 15+
- Android Studio/Xcode if you want to run mobile on device/simulator

Verified on this machine:
- `node --version` -> `v24.12.0`
- `npm.cmd --version` -> `11.6.2`
- `py --version` -> `Python 3.11.0`

Notes:
- Use `npm.cmd` on Windows PowerShell when execution policy blocks script shims.
- `yarn` is not required; use npm workspaces directly.

## 2) Install Dependencies

From repo root:

```powershell
Set-Location "c:\Thun\thun.ai"

# Node workspaces (backend + mobile)
npm.cmd install

# Python package + dev tools
py -m pip install -e ".[dev]"
```

If your network uses SSL interception and you see `SELF_SIGNED_CERT_IN_CHAIN`, use your org CA/certificate settings for npm and Node before retrying.

## 3) Configure Environment

### Backend env

```powershell
Copy-Item .\backend\.env.example .\backend\.env
```

Edit `backend/.env` and set at least:
- `DATABASE_URL`
- `JWT_SECRET`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`

### Root env (optional for shared references)

```powershell
Copy-Item .\.env.example .\.env
```

## 4) Initialize Database

Create DB/user, then run schema:

```powershell
# Example (replace connection string as needed)
psql "postgresql://thunai:password@localhost:5432/thunai" -f .\backend\src\db\schema.sql
```

## 5) Run Services

### Backend

```powershell
Set-Location "c:\Thun\thun.ai"
npm.cmd --workspace backend run dev
```

Health check:
- `GET http://localhost:3000/health`

### Python core engine (CLI)

```powershell
Set-Location "c:\Thun\thun.ai"

# Diagnostics
py -m thunai.cli status

# Simulated drive (stub-safe)
py -m thunai.cli demo
```

### Mobile app

```powershell
Set-Location "c:\Thun\thun.ai"

# Metro bundler
npm.cmd --workspace mobile run start

# Android (new terminal)
npm.cmd --workspace mobile run android

# iOS (macOS only)
npm.cmd --workspace mobile run ios
```

Important mobile API note:
- `mobile/src/utils/constants.js` uses `process.env.BACKEND_URL` and otherwise defaults to `https://api.thun.ai`.
- For local backend testing, point `API.BASE_URL` to local backend host reachable by emulator/device:
  - Android emulator: `http://10.0.2.2:3000`
  - iOS simulator: `http://localhost:3000`
  - Physical phone: `http://<your-lan-ip>:3000`

## 6) Quick Verification Checklist

- Backend starts without env errors.
- `GET /health` returns `{ status: "ok" }`.
- Python `status` and `demo` commands run.
- Mobile launches and can call backend endpoints.

## 7) Visualization

## System Context

```mermaid
flowchart LR
    M[Mobile App\nReact Native] <-- BLE --> E[Edge Unit\nC++ RV1126]
    M <-- HTTPS JWT --> B[Backend API\nExpress + PostgreSQL]
    B --> A[Anthropic Claude]
    B --> O[OpenAI Fallback]
    P[Python Core\nthunai CLI Engine] --> C[config/default.yaml]
    P --> F[Feature Modules\npre_drive ivis therapist post_drive]
    P --> I[Intelligence Providers\nLLM SLM VLM]
```

## Runtime Data Flow (Drive Session)

```mermaid
sequenceDiagram
    participant OBD as OBD/Vehicle Signals
    participant Watch as Biometrics (HR/HRV)
    participant Edge as Edge IVIS Engine
    participant Mobile as Mobile IVIS UI
    participant API as Backend API
    participant LLM as LLM Providers

    OBD->>Edge: speed/rpm/throttle
    Watch->>Edge: HR/HRV stream
    Edge->>Mobile: stress index + interventions
    Mobile->>API: drive events + summaries
    API->>LLM: generate narrative/therapist response
    LLM-->>API: text output
    API-->>Mobile: feedback + trajectory
```

## 8) Useful Commands

```powershell
# Run backend tests
npm.cmd --workspace backend run test

# Run mobile tests
npm.cmd --workspace mobile run test

# Run python tests
py -m pytest tests -v
```
