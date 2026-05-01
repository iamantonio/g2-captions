# G2-Captions Decisions

Date started: 2026-04-29

This file records approved architectural decisions and rationale.

## Approved decisions

### D-0001 — Phase 1 phone platform strategy

Status: Approved by Tony, 2026-04-29  
Decision: **Dual-track architecture with Even Hub WebView-first integration and native-phone escape hatch.**

Rationale:

- Even Hub WebView-first is the fastest path to G2 display and officially documented plugin distribution.
- Continuous daily-driver mic behavior through Even Hub is still unproven, so native iOS/Android audio prototypes remain allowed as fallback paths.
- Phase 1 architecture must keep audio capture, ASR streaming, diarization, vocabulary correction, formatting, and display transport as separable interfaces.

### D-0002 — Cloud ASR benchmark acceptability

Status: Approved by Tony, 2026-04-29  
Decision: **Hybrid: cloud ASR allowed for benchmark prototype; offline degraded fallback remains in architecture.**

Approved benchmark shortlist:

1. AssemblyAI Universal-3 Pro Streaming
2. Deepgram Nova-3 Streaming
3. Speechmatics Real-Time
4. WhisperKit / whisper.cpp as offline fallback candidates

Rationale:

- Current target metrics — <=800 ms end-to-end latency, <=12% noisy WER, >=2 speaker labels, >=90% custom vocabulary hit rate — are most plausible with hosted streaming ASR first.
- Offline fallback is still required for degraded-network accessibility, but it may not meet all target metrics in V1.

### D-0003 — G2 integration boundary

Status: Approved by Tony, 2026-04-29  
Decision: **Official Even Hub SDK primary; reverse-engineered BLE research allowed; BLE write experiments are allowed only behind an explicit per-experiment safety gate.**

Rationale:

- Official SDK reduces firmware/device risk and is the distribution-compatible path.
- Community BLE protocol research may be needed if SDK display/audio constraints block daily-driver captioning.
- Any non-official BLE write pattern must be separately documented with expected packets, risk, rollback/stop condition, and Tony approval before execution.

### D-0004 — Benchmark corpus strategy

Status: Approved by Tony, 2026-04-29  
Decision: **Design benchmark harness around public datasets first; leave hooks for Tony-supplied noisy recordings and vocabulary.**

Rationale:

- Public datasets unblock Phase 1/2 design immediately.
- Tony-specific daily-driver validation remains required before claiming better-than-Conversate.

### D-0005 — Phase 1 architecture approval

Status: Approved by Tony, 2026-04-29  
Artifact: `docs/01-architecture.md`  
Decision: **Proceed to Phase 2 phone-side prototype.**

Approved implementation constraints:

- Even Hub WebView-first + native fallback architecture.
- AssemblyAI + Deepgram first benchmark, with Speechmatics third if needed.
- Stable partial captions can be displayed on the lens before finals to meet <=800 ms latency.
- Vendor diarization first, with pyannote/NeMo only if vendor labels fail.
- Proposed repo layout and Phase 2 implementation order approved.

### D-0006 — Phase 2 API/account boundary

Status: Active safety gate  
Decision: **No API keys, payment methods, vendor account setup, or live cloud audio upload without a separate Tony approval step.**

Rationale:

- Cloud ASR was approved architecturally, but credentials/accounts/payment and live audio transfer remain sensitive operations.
- Phase 2 starts with interfaces, fixture-mode harness, visual formatter, local correction, and mock/fixture ASR contract tests.

## Current approval gate

### G-0003 — Vendor API key/account/live cloud benchmark approval

Status: Approved by Tony, 2026-04-29  
Artifact: Phase 2 scaffold and fixture harness first.

Tony approved proceeding with the first live ASR benchmark gate after reviewing the Phase 2 fixture prototype status.

Implementation scope approved for this step:

- First vendor: AssemblyAI, following the already-approved benchmark order.
- Auth path: browser/WebView uses temporary streaming tokens; API keys must not be embedded in the WebView or committed to files.
- First cloud audio source: benchmark/prototype source only; do not claim daily-driver quality until measured on noisy Tony/public data.
- Network permission: whitelist the AssemblyAI streaming origin required for live benchmark sessions.

Vendor facts used for this step:

- AssemblyAI Universal-Streaming uses WebSocket endpoint `wss://streaming.assemblyai.com/v3/ws` and can authenticate with a temporary `token` query parameter instead of an API key header. Source: https://assemblyai.com/docs/api-reference/streaming-api/universal-streaming/universal-streaming
- Temporary tokens are generated server-side from `/v3/token`, are one-time use, and `expires_in_seconds` must be 1-600 seconds. Source: https://assemblyai.com/docs/streaming/authenticate-with-a-temporary-token
- Universal-3 Pro Streaming model identifier is `u3-rt-pro`; sessions are billed by open WebSocket session duration, so clients must send `{"type":"Terminate"}` when finished. Source: https://assemblyai.com/docs/streaming/universal-3-pro

### D-0007 — Even Hub SDK dependency pinning policy

Status: Approved by Tony, 2026-04-30
Decision: **`@evenrealities/even_hub_sdk` stays pinned at `^0.0.10`. Upgrades require manual review and a successful hardware smoke before merging.**

Rationale:

- `@evenrealities/even_hub_sdk` is pre-1.0; npm semver treats `^0.0.x` as exact, so no automatic minor/patch updates flow in. Dependabot is configured to surface new releases as PRs (D-4 fix), but each one needs human review.
- The SDK is the only sanctioned BLE write path (D-0003) and a behavioral change in the bridge contract can break captioning silently. Any new release must pass a hardware smoke (per `docs/11-hardware-smoke.md`) before merge.
- This decision documents the _intent_ behind the existing pin; no code change is required today.

### D-0008 — Wearer-voice suppression: Path 2 (enrollment) is the way, gated on diarization

Status: Path 1 (hardware signal) ruled out 2026-05-01; Path 2 selected, blocked on diarization gap
Decision: **Wearer-voice suppression ("don't transcribe my own voice, only show others") will be implemented via Path 2 (speaker enrollment + filter) once the diarization gap from `docs/13-first-hardware-run.md` is resolved. Path 1 (G2 hardware wearer-speaking signal) is not feasible — the SDK does not expose one.**

Rationale:

- The feature is genuinely valuable for the deaf-first product surface: the wearer doesn't need captions of themselves; they need captions of the people they're talking to.
- Three implementation paths were considered:
  - **Path 1 — Hardware signal** (originally cleanest): would have required the G2 SDK to expose a "wearer is speaking" event (bone-conduction sensor, dedicated VAD, or similar). **Ruled out 2026-05-01.** Tony's review of available product docs and reviews as of 2026-05: G2 has a 4-mic array but no documented bone-conduction sensor, no accelerometer-based voice-activity API, and the SDK delivers only a single downmixed 16 kHz mono PCM stream over Bluetooth 5.2. Strongest evidence: Even Realities' own teleprompter feature, which detects when the wearer reads aloud, does so app-side via the phone mic — they would presumably use a hardware signal for their own product if one existed. Reaching out to vendor support could still produce a different answer, but the documented surface doesn't have it.
  - **Path 2 — Speaker enrollment + filter** (now the canonical path): record a 15–30 s voice profile of the wearer, compute an embedding (Resemblyzer / SpeechBrain / a vendor that supports speaker enrollment), score each utterance against it on the broker side, drop matches before they reach the lens. **Remaining blocker:** requires working diarization underneath. The 2026-05-01 hardware run returned `speaker: "0"` for both voices in a two-speaker session, so Path 2 has no foundation today. The diagnostic shipped in commit [`7e77767`](.) (`speakerWordCounts` in telemetry JSON) will tell the next conversational run whether the gap is a vendor / model limitation or a mapper bug — that decision feeds straight into this one.
  - **Path 3 — Acoustic proximity heuristic** (cheap, unreliable): the wearer's voice is louder + closer; classify by RMS energy + spectral characteristics. ~80% accuracy is unacceptable for a deaf-first feature where false negatives hide other people's speech. Reserved as a fallback only if Path 2 also fails on G2's mono PCM.
- If the diagnostic shows Deepgram itself can't separate the two voices on the G2's mono mic, this decision converges with the deferred Wave 3 fix #39 (strategy pattern + new vendor adapter) and likely D-0005 (Speechmatics adapter). At that point the vendor swap stops being speculative architecture cleanup and becomes the unblock-step for both diarization _and_ wearer-voice suppression.
- Until the diarization prerequisite is answered, no code change here. This decision exists so the question doesn't get lost between hardware sessions.

Pending actions:

- ~~Tony: ask Even Realities whether G2 has a wearer-speaking signal.~~ **Done 2026-05-01: no signal exposed.**
- Next conversational hardware run: read `speakerWordCounts` in the telemetry JSON to close the diarization gap (vendor vs. mapper).
- Reconvene this decision once the diarization answer is in. If vendor limitation → swap (D-0005 / fix #39) → then build Path 2. If mapper bug → fix mapper to expose per-utterance speaker breakdown → then build Path 2 directly.
