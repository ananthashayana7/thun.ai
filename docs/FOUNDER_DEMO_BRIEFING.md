# thun.ai Founder Demo Briefing

## 1. The Core Positioning

### One-line pitch

thun.ai is a safety-first driving support layer for anxious and under-confident drivers. Instead of trying to automate the vehicle, it reduces panic, overload, and poor decisions before they become safety incidents.

### What to say in the first 30 seconds

"We are not building another ADAS product. ADAS tries to automate the road. We are focused on the human being inside the car. Millions of drivers are licensed but still not confident enough to drive calmly in dense traffic, narrow lanes, merges, or after a bad experience. That lack of confidence is not just emotional; it is a real safety risk. thun.ai is a driver-state-aware safety layer that helps drivers choose calmer routes, stay regulated during stressful moments, recover safely if they freeze, and build confidence over time."

### The category we belong to

- `Not`: autonomy
- `Not`: generic infotainment
- `Not`: just another alerting system
- `Yes`: driver-state-aware safety assistance
- `Yes`: confidence-building intervention layer
- `Yes`: emotionally intelligent in-cabin safety software

### The strategic framing

The automotive market is moving away from overpromising automation and toward features that measurably improve safety, trust, and daily drivability. thun.ai fits that shift because it targets a real accident pathway that most vehicle systems ignore:

1. Driver stress rises.
2. Judgment narrows.
3. The driver freezes, overcorrects, hesitates, or makes a poor maneuver.
4. Safety risk increases even though the vehicle itself may be functioning perfectly.

Our system is built to interrupt that chain early.

## 2. The Problem We Solve

### The real user problem

There is a large gap between getting a license and becoming a calm, independent driver.

Many drivers:

- avoid driving after a bad incident or near miss
- panic around trucks, merges, flyovers, or narrow lanes
- freeze in slow urban traffic or after a stall
- choose longer, familiar roads because the "fastest" route feels unsafe
- do not need autonomy, but do need support in moments where fear takes over

### Why current products fail this user

Existing systems mostly optimize for:

- automation
- collision warnings
- navigation efficiency
- infotainment convenience

They do not optimize for:

- the driver's confidence threshold
- psychological overload
- non-intrusive intervention timing
- confidence recovery after stressful events
- long-term behavior change

### The founder/investor version of the problem

The industry has a blind spot: a meaningful share of risky driving behavior is not caused by lack of information, but by overload, panic, and hesitation in difficult driving contexts.

That means there is a product gap between:

- `traditional ADAS`, which reacts to external hazards
- `driver coaching`, which usually happens outside the moment

thun.ai sits in that gap.

## 3. Our Solution

### The simple description

thun.ai is a closed-loop safety support system that works across the full driving journey:

1. Before the drive, it reduces exposure to stress triggers.
2. During the drive, it detects rising stress and intervenes calmly.
3. If the driver stalls or freezes, it supports safe recovery.
4. After the drive, it turns the experience into confidence growth instead of avoidance.

### The four-part solution

#### A. Pre-drive: safer route choice for the human, not just the map

The system scores routes not only by ETA, but by likely driver stress using factors like:

- accident-zone exposure
- traffic load
- merge density
- heavy-vehicle likelihood
- narrow-lane exposure
- user-specific trigger preferences

This matters because the fastest route is often not the safest route for an anxious driver.

#### B. In-drive: intervention only when the driver actually needs it

The system computes a composite stress index from vehicle signals, biometrics, and computer-vision inputs, then decides whether to intervene.

The design philosophy is important:

- not constant nagging
- not generic alarms
- not voice overload
- only calm, contextual support when thresholds are crossed

#### C. Confidence corridor: convert fear in tight spaces into measurable safety support

One of the most compelling concepts in the current build is the "confidence corridor" for narrow passages.

Instead of telling the driver "be careful," the system tells them:

- whether they will fit
- how much room is left
- what speed is appropriate
- whether stopping is the correct decision

This turns a vague fear response into a measurable safety decision. It also reinforces successful passages so the driver builds spatial confidence over time.

#### D. Post-drive: confidence building, not just incident logging

After each drive, the system generates:

- a confidence report
- specific coaching based on stressful moments
- synthetic future practice scenarios
- adaptive calibration of intervention thresholds

The result is that the system does not just prevent bad moments; it helps the driver become safer over repeated drives.

## 4. What Is Happening In The Demo

### Demo story in plain English

"The app first understands what kind of driver you are, what situations make you tense, and what kind of vehicle you drive. Then it recommends a calmer route, not just a faster one. Once the drive begins, it watches stress signals and only intervenes when the driver crosses a personalized threshold. If the driver enters a tight-space situation, the system gives a confidence corridor instead of vague warnings. If the driver stalls or stops under stress, the system switches into recovery mode. At the end, it turns the session into a confidence-building report and next-step coaching."

### Step-by-step live demo script

#### Step 1: Onboarding

Say:

"We start by building a personal safety profile. We ask about driving experience, triggers, accident history, judgment sensitivity, avoidance behavior, preferred language, and vehicle width. This matters because two drivers on the same road can have very different safety needs."

Why it matters:

- personalization from day one
- not one-size-fits-all alerts
- vehicle width directly powers narrow-lane confidence decisions

#### Step 2: Pre-drive calm route planning

Say:

"Here the system recommends the least stressful route, not just the shortest route. It considers live traffic, accident risk, merges, heavy vehicles, narrow lanes, and the driver's trigger preferences. This is a safety decision before the vehicle even moves."

Why it matters:

- reduces exposure before risk escalates
- lets OEMs offer emotional safety, not only physical safety
- creates a differentiated navigation experience

#### Step 3: Confidence corridor preview

Say:

"This is one of our strongest concepts. If the route contains a likely narrow passage, we preview a confidence corridor. The product begins preparing the driver for a specific stressful moment instead of waiting to react when panic has already started."

Why it matters:

- proactive rather than reactive
- human-centered safety
- strong visual storytelling in a founder demo

#### Step 4: Real-time drive assistance

Say:

"During the drive, the system continuously computes a stress index from vehicle behavior, biometrics, and vision signals. But we are careful about intervention design. We use a speed gate so voice prompts do not distract at high speed. We apply cooldown logic so the system does not become another source of overload. And we prioritize emergency overrides and stall recovery when safety demands it."

Important founder line:

"The intelligence here is not in shouting earlier. It is in knowing when not to interrupt."

#### Step 5: Stall and roadside recovery

Say:

"If stress spikes and the car is stationary or stalled, the system shifts from driving assistance into recovery assistance. That matters because many anxious drivers are not dangerous because they speed; they are dangerous because they freeze."

Why it matters:

- new safety angle versus classic ADAS
- highly relatable use case
- strong emotional resonance in a demo

#### Step 6: Post-drive confidence report

Say:

"The drive does not end as a scary memory. It ends as a structured learning moment. We generate a calm confidence report, identify stressful events, create practice scenarios, and adjust thresholds over time so the product gets better for this specific driver."

Why it matters:

- turns episodic use into longitudinal value
- makes the system habit-forming
- creates measurable progress and retention

## 5. The Problems We Already Solved

These are the problems the current codebase is already addressing in a meaningful way.

### 1. Generic navigation is not safety-aware for anxious drivers

Solved by:

- route scoring using traffic, merges, accident zones, heavy vehicles, and narrow-lane heuristics
- user trigger preferences
- route sorting by calm score

### 2. Most in-car systems either over-alert or do not personalize enough

Solved by:

- personalized thresholds from onboarding
- composite stress scoring
- intervention cooldowns
- speed-gated voice prompts
- different intervention types for different conditions

### 3. Existing safety systems rarely account for emotional overload

Solved by:

- stress-aware decisioning
- breathing cues
- calm voice prompts
- stationary-only therapist mode
- post-drive emotional recovery loop

### 4. Drivers in tight spaces need factual reassurance, not generic warnings

Solved by:

- vehicle-width capture
- confidence corridor previews
- in-drive spare-width guidance
- "stop is a correct decision" reinforcement
- long-term spatial confidence memory

### 5. Products break in low-connectivity or real-world mobile conditions

Solved by:

- offline-first local storage
- queued sync and replay
- local drive history
- cached feedback results
- graceful fallback behavior

### 6. Safety products need trust, privacy, and operational discipline

Solved by:

- backend JWT authentication path
- rate limiting
- audit logging
- request tracing
- privacy consent APIs
- export and deletion request flows
- local encrypted storage path via secure key management

## 6. Why This Is Valuable For Automotive Companies

### OEM value proposition

For automakers, thun.ai can be positioned as:

- a safety differentiator for first-time and family drivers
- a premium in-cabin assistance feature without autonomy risk
- a mental-load reduction layer for congested urban markets
- a retention and engagement feature through longitudinal confidence tracking

### Why this is more timely than ADAS-first messaging

ADAS is facing skepticism because:

- it is expensive to perfect
- it carries high trust risk
- it is easy to overpromise and underdeliver
- customers increasingly care about dependable safety over futuristic claims

thun.ai avoids that trap because we are not claiming to drive the car. We are helping the driver stay calm enough to drive safely.

### The wedge

This can enter the market as:

- a software differentiation layer for OEM infotainment / safety packages
- an aftermarket pilot kit using phone + OBD + watch
- a fleet or driving-school confidence product before deeper OEM integration

## 7. The Product Differentiation

### What makes thun.ai different

#### 1. Human-state safety, not just road-state safety

Most systems ask: "What is happening outside the car?"

We also ask: "What is happening inside the driver?"

#### 2. Full journey loop

We do not only solve the moment of risk. We solve:

- route choice before it
- intervention during it
- recovery after it
- learning for the next drive

#### 3. Confidence is treated as a measurable safety variable

The product explicitly models:

- trigger preferences
- intervention thresholds
- spatial confidence
- confidence trajectory over time

#### 4. Intervention design is deliberately non-intrusive

The system includes:

- speed gating
- cooldown logic
- emergency priority override
- stationary-only therapist usage

That means the product is designed to avoid becoming a distraction itself.

## 8. What Is Actually Built Today

This section is important for founder credibility. These are real implemented surfaces in the repo, not just roadmap claims.

### Demo-ready now

- onboarding with driver profile, triggers, language, and vehicle width
- pre-drive route scoring and route comparison
- confidence corridor route preview
- in-drive stress gauge and intervention orchestration
- calm audio, HUD alerts, breathing cues, lane guidance, stall protocol, emergency override
- post-drive reporting and next-time scenario suggestions
- stationary-only therapist chat
- offline queueing and sync replay
- local storage and profile persistence
- privacy consent, export request, and deletion request plumbing

### Reliability and backend maturity already visible

- per-user rate limiting
- request ID tracing
- audit logs
- validation on protected endpoints
- LLM fallback chain
- circuit breaker behavior
- feedback caching

### What we verified locally

As of this review:

- backend test suite passed: `115/115`
- mobile test suite passed: `62/63`
- the one failing mobile test is a test harness issue in a mocked OBD unit test, not a demonstrated product-flow failure

### What still belongs in roadmap, not in the claim section

- real edge hardware validation on target RV1126
- real CV model integration for emergency vehicles, lane position, and side-clearance sensing
- backend proxying of direct mobile calls to external providers before production rollout
- full production-grade auth onboarding rather than provisioned tokens
- broader pilot validation with real vehicles and drivers

## 9. The Tech Stack, Framed The Right Way

Only mention the stack as proof that the solution can be delivered safely and pragmatically.

### Short version

"We built the system so the safety-critical loop can run close to the driver, while heavier personalization and coaching can run through the mobile and backend layers."

### Supporting stack

- Mobile app: React Native
- Backend API: Node.js + Express
- Database: PostgreSQL
- Edge runtime: C++ on RV1126 path
- Local persistence: SQLite
- AI providers: fallback-based LLM architecture with Gemini, Claude, and OpenAI paths in the repo
- On-device/edge logic: stress computation and intervention dispatch designed to work locally

### Why the stack matters strategically

- mobile gives fast product iteration
- backend keeps keys and sensitive orchestration server-side
- local storage supports poor connectivity and privacy
- edge runtime supports sub-50 ms safety aspirations
- provider abstraction prevents lock-in and improves reliability

## 10. The Roadmap

### Phase 1: Pilot-ready safety software

Goal:

Prove measurable value with mobile + OBD + smartwatch + backend loop.

Deliverables:

- tighten current mobile flow
- finish production API proxying for maps and TTS
- validate offline sync and privacy flows end to end
- run real-user pilots with anxious drivers
- produce baseline metrics: route avoidance reduction, fewer freeze/stall episodes, confidence improvements

### Phase 2: Sensor-fused safety layer

Goal:

Replace heuristic or simulated signals with richer real-world sensing.

Deliverables:

- real side-clearance estimation for the confidence corridor
- stronger lane positioning and emergency-vehicle detection
- real hardware testing on edge board
- better personalization from real telemetry

### Phase 3: OEM integration

Goal:

Move from pilot product to embedded automotive feature.

Deliverables:

- OEM-tunable thresholds and interventions
- embedded edge deployment
- vehicle-grade validation and telemetry
- white-labeled in-cabin experience

### Phase 4: Longitudinal safety intelligence

Goal:

Turn the platform into a confidence and safety data layer.

Deliverables:

- confidence trajectory visualization
- progressive exposure route coaching
- population-level trigger insights
- insurer, fleet, and driver-training partnerships

## 11. The Best Investor/Funder Narrative

### The story to tell

"We are addressing an under-served safety problem at the human layer of driving. The market has spent years trying to automate vehicles, but a huge near-term opportunity is helping real drivers make safer decisions in the moments where fear, overload, and hesitation create risk. We already have a working full-journey product concept: calmer route selection, in-drive support, recovery logic, and post-drive confidence building. The next step is not inventing the category. It is validating and productizing it with pilot partners."

### Why investors should care

- large and relatable user pain
- strong alignment with current market shift toward practical safety
- software wedge before deep hardware dependency
- emotionally resonant demo
- plausible OEM, fleet, aftermarket, and driver-training pathways
- defensible data loop over time

## 12. Questions You Will Likely Get

### "Is this just ADAS with better branding?"

Answer:

"No. ADAS is primarily vehicle- and environment-centric. We are explicitly driver-state-centric. We are not claiming to automate the drive. We are reducing panic, freeze, overload, and poor decision-making in difficult real-world conditions."

### "Why won’t this become another annoying alert system?"

Answer:

"That is exactly why we built thresholding, speed gating, cooldowns, and stationary-only recovery modes. The point is not more alerts. The point is better-timed support."

### "What is the moat?"

Answer:

"The moat comes from the full-loop system: trigger-aware route selection, driver-state sensing, intervention logic, confidence memory, and longitudinal improvement data. This is not a single feature; it is a behavior and safety platform."

### "Why will OEMs care?"

Answer:

"Because this gives them a safety story they can credibly ship today. It improves trust and usability without promising autonomy. It is especially relevant for dense urban driving, first-time drivers, family buyers, and markets where driving stress is a real barrier to usage."

### "What is still not done?"

Answer:

"The concept and product loop are real today. What comes next is hardware validation, richer sensor fusion, production hardening of external API paths, and pilot deployment at scale."

## 13. What Not To Say In The Demo

- Do not say "self-driving"
- Do not say "autonomous intervention"
- Do not say "we replace the driver"
- Do not overclaim CV accuracy that is still on roadmap
- Do not position the therapist as a medical product
- Do not lead with model names or frameworks

Instead say:

- driver-state-aware safety
- confidence-aware driving assistance
- calm intervention layer
- non-intrusive support
- measurable confidence building
- practical safety for real drivers

## 14. The Closing Ask

### A strong closing line

"What we are proving is that safety does not only come from taking control away from the driver. Safety can also come from helping the driver stay calm, capable, and informed in the exact moments where things usually go wrong."

### If you are asking for funding

"We are raising to move from a strong working demo into pilot-grade validation: real-world user studies, production hardening, richer sensing, and OEM-ready integration. The category gap is real, the customer pain is real, and the product loop is already visible in what we have built."

## 15. Short Demo Script You Can Memorize

"thun.ai is a safety product, not an autonomy product. We help anxious and under-confident drivers make safer decisions before, during, and after a drive. Before the drive, we choose the calmest route based on personal triggers. During the drive, we compute stress from vehicle, biometric, and situational signals, then intervene only when needed using calm, non-distracting support. In difficult moments like narrow passages or stalls, we switch from generic alerts to factual recovery guidance. After the drive, we convert the experience into a confidence report and practice plan so the driver actually gets safer over time. That is the wedge: not replacing the driver, but making the driver more stable, more confident, and therefore safer." 
