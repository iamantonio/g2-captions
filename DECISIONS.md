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

### D-0009 — Production UI vs. debug UI split

Status: Approved by direction, 2026-05-01
Decision: **Default WebView UI is the user-facing production view (single primary action, captioned surface, status pill). Debug mode is opt-in via `?debug=1` and exposes all internal controls (fixture buttons, raw Connect, browser-mic, telemetry JSON panel).**

Rationale:

- The previous UI (a `<pre>` caption frame plus seven raw debug buttons and an open telemetry `<details>`) was usable for development but actively hostile to a real end user — too many controls, no clear primary action, no visual hierarchy, and a JSON dump under the captions.
- "Ship the product out" requires the WebView to look like a product on first install. That means: a single Start/Stop affordance, a calm caption surface, status communicated via plain text labels (not color alone — deaf-first), and developer noise hidden by default.
- Debug mode (`?debug=1`) is preserved as-is so all existing hardware-smoke / fixture-playback flows continue to work for developers; the appWiring smoke test runs in debug mode for the same reason.
- A small `lifecycleFromStatus` helper maps the controllers' visual-status strings (`G2 MIC LIVE`, `CONNECTING — token`, `ASR TERMINATED`, etc.) into a four-state UI lifecycle (`idle` / `connecting` / `live` / `stopped`). This keeps the new UI's button labels and status pill in sync with the deaf-first invariant: every meaningful state change still flows through a visual status, the production UI just consumes them as enum values instead of raw strings.
- WCAG AAA-target contrast palette in `public/styles.css`. Status pill uses both color **and** text label (e.g. `Listening`) so users who rely on text-to-speech or are colorblind get the same information.

Pending actions:

- Hardware-smoke the new production UI on real G2 to confirm: (a) the single Start button kicks off the G2 SDK audio path and the lens shows live captions, (b) the lens surface is unaffected (production-mode root produces the same frame text via `formatCaptionFrame`).
- `?autoSmoke=1` continues to work in production mode for hardware QR launches; verify next run.

### D-0010 — Broker hosting: Fly.io

Status: Approved by direction, 2026-05-01
Decision: **Deploy `tools/token-broker.ts` as a containerized Fly.io app for production `.ehpk` distribution. The dev-time loopback flow stays available for local work; the WebView picks the deployed broker over a build-time `VITE_BROKER_BASE_URL`.**

Rationale:

- The `.ehpk` installed via the Even Hub portal (`hub.evenrealities.com/hub`) has no LAN context — `runtimeConfig.ts` was deriving the broker URL from `locationUrl.hostname` and falling back to `127.0.0.1:8787`, which is the phone's loopback and has nothing listening. Symptom: lens shows `ASR TOKEN FAILED — check broker` on every Start.
- Fly.io was chosen over alternatives because it preserves the entire current broker architecture (long-lived WebSocket proxy, Pino logging, rate limits, bearer auth, Wave 2 fix #36 server-side parameter control). Cloudflare Workers would require rewriting the WS proxy on Durable Objects; Vercel would require dropping the proxy and shifting to direct-browser → Deepgram (loses fix #36). Fly.io is also generous enough on the free tier for an alpha audience.
- Build-time override (`VITE_BROKER_BASE_URL=https://...`) keeps local dev frictionless: unset → LAN-derived URLs (current behavior); set → production broker URL. WebView fetches and the WS upgrade both honor the override; manifest whitelist must list the deployed origin.

Tradeoffs / known limits:

- The bearer token (`VITE_BROKER_AUTH_TOKEN`) is now baked into every shipped bundle. Anyone with the `.ehpk` can extract it. This means the bearer is no longer a true secret — it's an "installed-user" gate, no stronger than what's on disk. The per-IP rate limiter (`rate-limiter-flexible`, 10 token mints/min) is the only abuse cap today.
- For a real ship to users beyond a known alpha list, layer real per-user authentication on top (OAuth / Sign-in-with-X) and tighter per-user minute caps on Deepgram streaming time. Until that lands, monitor Fly bandwidth + Deepgram billing closely.
- Deepgram streaming bills by minute. A leaked bundle = open bill. Set Deepgram's project-level usage cap as a hard ceiling.

Pending actions:

- Tony: `fly auth login`, `fly apps create <name>`, `fly secrets set ...` (DEEPGRAM_API_KEY, VITE_BROKER_AUTH_TOKEN), `fly deploy`.
- After deploy: rebuild `.ehpk` with `VITE_BROKER_BASE_URL=https://<app>.fly.dev npm run build`, re-upload to Even Hub portal, hardware-smoke verify.
- Update `app.json` `permissions[].whitelist` to include the chosen Fly hostname (currently only `https://api.deepgram.com` is listed; whitelist was found permissive for LAN/loopback per D-0008-adjacent spike but a production HTTPS origin should be explicit).

### D-0011 — Stay on Deepgram nova-3 streaming; do not adopt Flux

Status: Approved by direction, 2026-05-01
Decision: **Continue using Deepgram nova-3 streaming on `/v1/listen` for live captioning. Do not migrate to Deepgram Flux.**

Background: Tony asked us to evaluate Flux (https://developers.deepgram.com/docs/flux/quickstart) after a hardware session where the captions felt "all over the place." Initial read mischaracterized Flux as turn-only with no streaming partials; closer reading of the state-machine and configuration docs corrected that — Flux does emit `Update` messages every ~250ms during a turn, and turn boundaries are detected by a built-in model rather than silence-based VAD.

API surface differences (nova-3 → Flux):

- Endpoint: `wss://api.deepgram.com/v1/listen` → `wss://api.deepgram.com/v2/listen`
- Model: `nova-3` → `flux-general-en` or `flux-general-multi`
- Message shape: `Results` with `is_final`/`speech_final` flags → `Update` / `EagerEndOfTurn` / `EndOfTurn` / `TurnResumed` / `StartOfTurn`
- Configuration: ~12 params (diarize, endpointing, interim_results, smart_format, punctuate, etc.) → 4 params (`eot_threshold`, `eager_eot_threshold`, `eot_timeout_ms`, `language_hint`)
- State machine: implicit (per-result `is_final`) → explicit `Initial` / `TurnOngoing` / `AwaitingEnd` with documented transitions

Rationale for staying on nova-3:

- **No diarization in Flux.** The configuration page lists exactly four parameters; none are speaker-related. The state-machine page has no speaker concept. Flux is built for voice-agent use cases (one user → one agent) where speaker labels aren't needed. For a deaf-first captioner of multi-speaker conversations, losing the `S1`/`S2` speaker chips that were verified working on G2 in v0.3.0 would be a direct regression to product quality.
- **Likely worse perceived fluidity, not better.** Flux's `Update` cadence is ~0.25s. nova-3's real-world partial cadence on the G2 mic was measured at ~1s during the 2026-05-01 hardware runs (see `docs/13`). Switching to Flux would mean ~4× more in-flight text changes per second. The "all over the place" complaint that motivated this evaluation was the _renderer_ re-mounting DOM on every partial, not nova-3 emitting too many partials. v0.3.0 fixed the renderer (mount-once + incremental updates); switching vendors would re-introduce the underlying frequency at which the new renderer has to absorb changes.
- **Wrong shape for the use case.** `EagerEndOfTurn` / `TurnResumed` exist so a voice agent can speculatively prepare an LLM response and cancel it if the user keeps talking. A captioner has no analog — there's nothing to draft and cancel. Adopting Flux would mean handling messages designed for a problem we don't have.
- **Real migration cost.** Different endpoint, different message shapes, mapper rewrite, broker upstream URL change, manifest whitelist additions, broker redeploy, .ehpk rebuild + portal upload. Wave 3 fix #39 (the strategy-pattern refactor I deferred earlier) would _unblock_ a clean vendor swap if/when it's worth doing — but the trigger should be a real benefit, not a hypothetical.

When to revisit:

- If Deepgram adds diarization to Flux (watch the changelog).
- If a future product surface (a voice-agent feature that talks back to the wearer) makes Eager-EoT speculation valuable.
- If nova-3's `endpointing`/`interim_results` knobs prove insufficient for caption fluidity even after v0.3.0's renderer changes — and we want a model that emits cleaner turn boundaries.

Cheaper alternatives that stay on nova-3:

- Increase `endpointing` from the default 250 ms to 500–750 ms in `buildDeepgramStreamingUrl` to reduce partial→final flips per minute. Same vendor, same diarization, fewer perceived re-finalizations. One server-side env-driven change; no .ehpk rebuild.
- Optionally pair with `utterance_end_ms` for cleaner long-utterance segmentation.

Pending actions: none — this is a "do nothing" decision. Re-evaluation triggers listed above.
