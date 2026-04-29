# G2-Captions Phase 1 Architecture

Date: 2026-04-29  
Operator: Tony  
Mission: daily-driver real-time captioning for Even Realities G2, accessibility-first, measurably better than Conversate.

## Status

Phase 1 architecture draft is complete. No production code was written.

**Gate:** STOP after this document. Tony approval is required before Phase 2 phone-side prototype.

---

## 0. Approved constraints from Phase 0

Tony approved:

1. **Dual-track phone/platform strategy**: Even Hub WebView-first, with native iOS/Android escape hatch if WebView audio/display constraints block daily-driver use.
2. **Hybrid ASR strategy**: hosted/cloud ASR allowed for benchmark prototype; offline degraded fallback remains required.
3. **G2 integration boundary**: official Even Hub SDK primary; reverse-engineered BLE research allowed; non-official BLE write experiments require separate safety approval.
4. **Benchmark corpus strategy**: public datasets first, with hooks for Tony-supplied noisy recordings and custom vocabulary.

Decision log: `DECISIONS.md`

---

## 1. Architecture goals

### Must satisfy

| Target | Architecture implication |
|---|---|
| Caption-to-display latency <=800 ms | Use streaming ASR partials, avoid blocking on final transcripts, use incremental display updates, measure every stage. |
| Noisy WER <=12% | Benchmark multiple ASR vendors on noisy corpus before committing. |
| Speaker labels >=2 speakers | Prefer ASR vendor built-in streaming diarization first; keep dedicated diarization fallback. |
| Custom vocabulary hit rate >=90% | Use vendor keyterms/custom dictionary where available; add post-ASR vocabulary correction layer. |
| Lens readability via Tony testing | Formatter must be independently tunable: lines, characters, scroll, speaker label style, partial/final treatment. |
| Accessibility-first | Every state and error must be visible on the lens and phone; no audio-only cues. |

### Explicit non-goals for Phase 2 prototype

- No production billing/account setup without Tony approval.
- No reverse-engineered BLE writes.
- No claim of “better than Conversate” until measured on Tony’s G2 and benchmark set.
- No social/meeting assistant AI features; this is captioning first.

---

## 2. Component diagram

```text
          ┌─────────────────────────────────────────────────────────┐
          │                    Phone host app                        │
          │      Even Hub WebView first; native fallback allowed      │
          └─────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────┐      ┌──────────────────────┐      ┌─────────────────────┐
│ Audio capture  │─────▶│ Stream normalizer     │─────▶│ ASR streaming client │
│                │      │ 16 kHz mono PCM/op    │      │ partials + finals    │
└────────────────┘      └──────────────────────┘      └─────────────────────┘
       │                                                       │
       │                                                       ▼
       │                                        ┌────────────────────────────┐
       │                                        │ Diarization adapter         │
       │                                        │ vendor labels first         │
       │                                        └────────────────────────────┘
       │                                                       │
       ▼                                                       ▼
┌────────────────┐                         ┌────────────────────────────┐
│ Audio monitor  │                         │ Custom vocabulary layer     │
│ visual health  │                         │ keyterms + post-correction  │
└────────────────┘                         └────────────────────────────┘
                                                        │
                                                        ▼
                                          ┌────────────────────────────┐
                                          │ Caption state engine        │
                                          │ partial/final/stability     │
                                          └────────────────────────────┘
                                                        │
                                                        ▼
                                          ┌────────────────────────────┐
                                          │ Display formatter           │
                                          │ wrap/scroll/speaker labels  │
                                          └────────────────────────────┘
                                                        │
                                                        ▼
                                          ┌────────────────────────────┐
                                          │ G2 display transport        │
                                          │ Even Hub SDK primary        │
                                          └────────────────────────────┘
                                                        │
                                                        ▼
                                          ┌────────────────────────────┐
                                          │ Even Realities G2 lens      │
                                          │ visual captions + errors    │
                                          └────────────────────────────┘
```

### Interfaces

The architecture must keep these as swappable modules:

- `AudioSource`: G2 mic via Even Hub SDK, phone mic via browser/native, fixture audio for tests.
- `AsrClient`: AssemblyAI, Deepgram, Speechmatics, offline WhisperKit/whisper.cpp.
- `DiarizationAdapter`: vendor diarization, pyannoteAI, NVIDIA NeMo, none/degraded.
- `VocabularyAdapter`: vendor keyterms/custom dictionary + local post-correction.
- `CaptionFormatter`: lens text layout independent of ASR vendor.
- `DisplayTransport`: Even Hub SDK first; reverse-engineered BLE only behind future safety gate.

---

## 3. Capture path decision

### Option A — Even Hub WebView + G2 mic first

**What it uses:** `@evenrealities/even_hub_sdk` audio events and official display APIs.

Evidence:

- Even Hub docs say G2 has a 4-mic array exposed as a single 16 kHz PCM audio stream. Source: https://hub.evenrealities.com/docs
- SDK npm page says host-pushed audio is delivered as `audioEvent` in `onEvenHubEvent`, with PCM bytes in `event.audioEvent.audioPcm`. Source: https://www.npmjs.com/package/@evenrealities/even_hub_sdk
- SDK npm page describes glasses UI creation, audio/IMU control, and real-time event listening. Source: https://www.npmjs.com/package/@evenrealities/even_hub_sdk

**Pros:**

- Official plugin path.
- Fastest G2 lens integration.
- Uses G2 mic array if continuous capture works.

**Cons / risks:**

- Continuous daily-driver audio duration/background behavior is unverified.
- Even Hub WebView may restrict networking, backgrounding, and long-running sessions. **[unverified]**
- Phone-side browser APIs may not expose enough low-level audio control inside Even app WebView. **[unverified]**

### Option B — Native iOS audio prototype

Evidence:

- Apple live speech sample uses `SFSpeechRecognizer`, `SFSpeechAudioBufferRecognitionRequest`, `AVAudioSession`, and `AVAudioEngine` for live microphone recognition. Source: https://developer.apple.com/documentation/Speech/recognizing-speech-in-live-audio
- Apple sample supports custom language model data and custom pronunciations. Source: https://developer.apple.com/documentation/Speech/recognizing-speech-in-live-audio

**Pros:**

- Strong control over audio capture and iOS audio pipeline.
- Enables WhisperKit/offline path.
- Native UI can support robust settings and visual error states.

**Cons / risks:**

- Direct G2 display integration outside Even Hub may be limited.
- App distribution/review path differs from Even Hub plugin path.
- Tony’s exact daily phone platform was not confirmed in Phase 0. **[unverified]**

### Option C — Native Android audio/BLE prototype

Evidence:

- Android 14+ requires foreground services to declare service types. Sources: https://developer.android.com/about/versions/14/changes/fgs-types-required and https://developer.android.com/develop/background-work/services/fgs/service-types
- Android foreground service types include `microphone` and `connectedDevice`; `connectedDevice` covers Bluetooth/external-device interaction with Bluetooth runtime prerequisites. Source: https://developer.android.com/develop/background-work/services/fgs/service-types

**Pros:**

- Explicit foreground-service model for microphone and connected-device work.
- Good environment for BLE/protocol experiments if approved later.

**Cons / risks:**

- May not match Tony’s daily phone.
- Official Even Hub plugin/app ecosystem still likely needed for distribution.
- Android audio stack/device variation can affect latency and reliability.

### Recommendation

**Phase 2 prototype should start Even Hub WebView-first and immediately test continuous audio + display update behavior.** If WebView/G2 mic behavior fails daily-driver requirements, split to native iOS/Android audio prototype while keeping formatter/ASR/state modules unchanged.

This is not a final phone-platform lock. It is an architecture that prevents lock-in.

---

## 4. ASR/vendor decision matrix

No final ASR vendor is committed. Phase 2 must benchmark at least two hosted vendors before selecting.

| Vendor/path | Latency evidence | Diarization | Custom vocabulary | Cost evidence | Privacy/offline | Recommendation |
|---|---:|---|---|---:|---|---|
| AssemblyAI Universal-3 Pro Streaming | Docs claim sub-300 ms time-to-complete transcript latency | Streaming speaker labels; short turns under ~1s may be `UNKNOWN` | Dynamic keyterms up to 100 | $0.45/hr U3 Pro streaming + $0.12/hr diarization | Cloud | **Primary benchmark candidate** |
| Deepgram Nova-3 Streaming | Vendor claims real-time transcripts under 300 ms | Streaming diarization with `diarize=true` | Keyterm prompting up to 100 | $0.0077/min | Cloud | **Primary benchmark candidate** |
| Speechmatics Real-Time | Claims 90%+ accuracy with <1s latency; partials in few hundred ms; caveat final can vary | Real-time speaker/channel diarization | Custom dictionary up to 1000 words/phrases | Pro realtime from ~$0.24/hr | Cloud / enterprise deployment | **Secondary benchmark candidate; strong custom vocab** |
| OpenAI Realtime / GPT-4o Transcribe | Realtime low-latency platform; exact caption latency unverified | File diarization exists; realtime diarization unverified | Prompting exists; diarized prompt behavior unclear | Token-based; effective per-minute cost unverified | Cloud | Watchlist, not Phase 2 primary |
| WhisperKit / whisper.cpp | On-device latency depends model/device; WhisperKit paper claims 0.46s latency in benchmark | No robust built-in diarization path equivalent to hosted vendors | Custom vocab weaker than vendor keyterms | No API cost | Offline | Degraded/offline fallback track |

Sources:

- AssemblyAI U3 Pro Streaming: https://www.assemblyai.com/docs/speech-to-text/streaming/universal-3-pro
- AssemblyAI diarization: https://assemblyai.com/docs/streaming/label-speakers-and-separate-channels
- AssemblyAI keyterms: https://www.assemblyai.com/docs/streaming/keyterms-prompting
- AssemblyAI pricing: https://www.assemblyai.com/pricing
- Deepgram product: https://deepgram.com/product/speech-to-text
- Deepgram diarization: https://developers.deepgram.com/docs/diarization
- Deepgram keyterm prompting: https://developers.deepgram.com/docs/keyterm-prompting
- Deepgram pricing: https://deepgram.com/pricing
- Speechmatics realtime: https://www.speechmatics.com/product/real-time
- Speechmatics diarization: https://docs.speechmatics.com/speech-to-text/realtime/realtime-diarization
- Speechmatics custom dictionary: https://docs.speechmatics.com/speech-to-text/features/custom-dictionary
- Speechmatics pricing: https://www.speechmatics.com/pricing
- OpenAI speech-to-text: https://developers.openai.com/api/docs/guides/speech-to-text
- WhisperKit: https://github.com/argmaxinc/WhisperKit
- whisper.cpp: https://github.com/ggml-org/whisper.cpp

### Vendor recommendation for Phase 2 benchmark

Benchmark in this order:

1. **AssemblyAI Universal-3 Pro Streaming** — best documented combination of low latency, streaming diarization, and dynamic keyterms.
2. **Deepgram Nova-3 Streaming** — strong cost/latency/keyterm candidate.
3. **Speechmatics Real-Time** — run if custom vocabulary or diarization quality underperforms in first two.

Phase 2 must expose vendor as config, not compile-time choice.

---

## 5. Latency budget

Target: **<=800 ms spoken word → glyph rendered on lens**.

This budget assumes captions are allowed to display stable partials before final ASR output. If we wait for final transcripts only, the target is likely at risk.

| Stage | Budget | Notes |
|---|---:|---|
| Audio capture frame/chunk | 80 ms | Use small chunks; avoid buffering >100 ms. |
| Audio normalization/encoding | 30 ms | Prefer raw PCM where vendor supports it. |
| Network uplink | 80 ms | Mobile network/Wi-Fi dependent; measure separately. |
| ASR partial emission | 250 ms | Vendor claims are often <300 ms; benchmark actual. |
| Diarization label attach | 80 ms | Prefer vendor built-in labels; avoid separate model in fast path. |
| Custom vocabulary correction | 25 ms | Local deterministic correction only; no LLM in fast path. |
| Caption state/formatter | 25 ms | Pure local operations. |
| SDK display update / BLE transport | 150 ms | Must measure with G2; use incremental text update. |
| Display refresh / render visibility | 80 ms | G2 refresh rate listed as 60 Hz in support specs; end-to-visible method TBD. Source: https://support.evenrealities.com/hc/en-us/articles/13499229138959-Specs |
| **Total** | **800 ms** | Leaves no slack; all instrumentation required. |

### Latency rules

- Never block lens display on transcript finalization if a stable partial is available.
- Diarization must not block initial caption text; speaker labels can update after first text if needed.
- Custom vocabulary correction must be deterministic and local in the hot path.
- If network exceeds budget, show visual degraded state and fall back to local captions if available.

---

## 6. Caption state model

### Transcript event model

```text
RawAsrEvent
  vendor
  text
  isPartial | isFinal
  startMs
  endMs
  confidence?
  words?
  speaker?
  receivedAtMs

CaptionSegment
  id
  speakerLabel
  text
  status: partial | stable | final | corrected
  startMs
  endMs
  displayPriority
```

### Partial/final behavior

- Show partials fast.
- Mark final text internally, but do not visually depend on audio cues.
- Use visual stability treatment:
  - current live line: normal green text
  - final/stable lines: slightly dimmer if SDK color supports it; otherwise prefix or layout distinction
- If ASR revises text, update same segment instead of appending duplicates.

### Speaker labels

Initial lens labels:

```text
A: where should we start with the budget
B: let’s start with timing
```

Rules:

- Use `A`, `B`, `C` labels, not color-only labels, because G2 is green-scale and accessibility cannot depend on color.
- If speaker is unknown, show `?:` not silence/failure.
- If label changes after diarization stabilizes, update recent line visually.

---

## 7. Display formatter architecture

### Constraints

Even Hub developer docs list a 576 × 288 per-eye display and 4-bit green greyscale. Source: https://hub.evenrealities.com/docs

Even Hub apps use SDK-defined containers rather than arbitrary HTML/CSS on glasses. Source: https://hub.evenrealities.com/docs

The SDK exposes `TextContainerProperty` and `textContainerUpgrade` for dynamic text updates; community SDK verification says `textContainerUpgrade` updates text without rebuilding the full page and avoids flicker. Source: https://zenn.dev/bigdra/articles/eveng2-sdk-features?locale=en

### Proposed lens layout V1

```text
G2 CAPTIONS       LIVE  143ms
A: we should move the review
   to Friday morning
B: Friday works if the deck is
   ready by Thursday night

NET OK  MIC G2  ASR AAI
```

### Formatter settings

Phase 2/3 must support:

- max visible lines
- characters per line
- speaker label style: `A:` / `[A]` / hidden
- live partial mode: inline vs bottom-only
- scroll mode: replace oldest vs smooth page
- error/status row: always visible vs compact

### Visual error states

No audio-only errors. Minimum lens states:

```text
MIC BLOCKED — check permission
G2 MIC LOST — using phone mic
NETWORK SLOW — offline captions
ASR LOST — reconnecting
G2 DISCONNECTED — captions on phone
VOCAB LOADED — 37 terms
```

Phone UI must mirror the same states in larger text.

---

## 8. Custom vocabulary layer

### Vendor-side

- AssemblyAI supports up to 100 streaming keyterms and dynamic updates during active sessions. Source: https://www.assemblyai.com/docs/streaming/keyterms-prompting
- Deepgram keyterm prompting supports up to 100 terms for Nova-3 / Flux. Source: https://developers.deepgram.com/docs/keyterm-prompting
- Speechmatics custom dictionary supports up to 1000 words/phrases and `sounds_like` pronunciation hints. Source: https://docs.speechmatics.com/speech-to-text/features/custom-dictionary

### Local post-processing

Hot path must be deterministic:

1. normalize ASR words
2. compare against custom vocabulary aliases/pronunciations
3. replace only when confidence/phonetic distance threshold is met
4. log every correction for review
5. never run LLM correction in the live caption path

Example vocabulary object:

```json
{
  "canonical": "ProvenMachine",
  "aliases": ["proven machine", "proven machina"],
  "soundsLike": ["proh ven machine"],
  "category": "company",
  "priority": 10
}
```

### Metric

Custom vocabulary hit rate:

```text
correct custom terms displayed / custom terms spoken
```

Target: >=90% on Tony’s wordlist.

---

## 9. Offline / degraded-network fallback

### Modes

| Mode | Trigger | Behavior | Expected metric status |
|---|---|---|---|
| Cloud primary | network healthy | Hosted ASR + diarization + keyterms | Target-capable |
| Cloud degraded | latency/network unstable | Show network status; keep partials; reduce update frequency if needed | May miss <=800 ms |
| Offline captions | cloud unavailable | WhisperKit/whisper.cpp or platform speech if available | Likely no target diarization/custom vocab |
| Phone-only display | G2 disconnected | Continue captions on phone with visual reconnect state | Accessibility fallback |
| No mic permission | mic blocked | Visual instruction and stop capture | No silent failure |

### Degraded behavior requirements

- If cloud drops, keep last readable captions on lens and show visual state.
- If offline model is unavailable, display `ASR OFFLINE UNAVAILABLE`, not a spinner-only state.
- If G2 disconnects, phone UI must continue captions where possible.
- Never hide failure behind a sound/vibration-only cue.

---

## 10. Repo layout

```text
g2-captions/
├── README.md
├── DECISIONS.md
├── docs/
│   ├── 00-research.md
│   ├── 01-architecture.md
│   ├── 02-prototype-report.md          # Phase 2 output
│   ├── 03-g2-integration-report.md     # Phase 3 output
│   └── benchmark-plan.md
├── src/
│   ├── audio/
│   │   ├── AudioSource.ts
│   │   ├── evenHubAudioSource.ts
│   │   ├── browserMicAudioSource.ts
│   │   └── fixtureAudioSource.ts
│   ├── asr/
│   │   ├── AsrClient.ts
│   │   ├── assemblyAiClient.ts
│   │   ├── deepgramClient.ts
│   │   └── speechmaticsClient.ts
│   ├── diarization/
│   │   └── DiarizationAdapter.ts
│   ├── vocab/
│   │   ├── VocabularyStore.ts
│   │   └── corrector.ts
│   ├── captions/
│   │   ├── CaptionState.ts
│   │   ├── formatter.ts
│   │   └── latency.ts
│   ├── display/
│   │   ├── DisplayTransport.ts
│   │   ├── evenHubDisplay.ts
│   │   └── phoneDisplay.ts
│   ├── app/
│   │   └── main.ts
│   └── types.ts
├── tests/
│   ├── fixtures/
│   │   ├── audio/                       # not committed if large/private
│   │   └── transcripts/
│   ├── unit/
│   │   ├── formatter.test.ts
│   │   ├── vocab.test.ts
│   │   └── captionState.test.ts
│   └── integration/
│       ├── latencyHarness.test.ts
│       └── asrContract.test.ts
└── tools/
    ├── run-benchmark.ts
    ├── score-wer.ts
    └── generate-latency-report.ts
```

### Phase 2 smallest viable prototype

Before G2 hardware integration:

- Use fixture audio and/or phone mic.
- Stream to AssemblyAI and Deepgram behind shared `AsrClient` interface.
- Produce normalized caption events with speaker labels when available.
- Apply custom vocabulary layer.
- Render formatted text to terminal/phone UI.
- Produce `docs/02-prototype-report.md` with latency/WER/custom-vocab results.

---

## 11. Tech stack proposal

### Even Hub WebView prototype

- TypeScript + Vite
- `@evenrealities/even_hub_sdk`
- Vitest for pure modules
- Browser/WebView WebSocket clients for ASR vendors if CORS/auth model permits **[unverified]**
- Minimal token broker only if vendor requires secret isolation

### Native fallback prototypes

- iOS: Swift / AVAudioEngine / WebSocket ASR / WhisperKit fallback
- Android: Kotlin / foreground service microphone + connectedDevice if needed / WebSocket ASR

### Benchmark tooling

- TypeScript or Python scoring scripts
- WER scoring with standard word normalization
- JSONL event logs for latency:

```json
{"t": 123.4, "stage": "audio_chunk_sent", "seq": 18}
{"t": 354.8, "stage": "asr_partial_received", "seq": 18}
{"t": 491.2, "stage": "caption_formatted", "seq": 18}
{"t": 630.0, "stage": "display_update_sent", "seq": 18}
```

---

## 12. Testing and measurement plan

### Unit tests

- formatter line wrapping and speaker labels
- partial/final transcript state merging
- vocabulary correction thresholds
- visual error-state rendering
- latency event aggregation

### Integration tests

- fixture audio → ASR client → caption events
- simulated network slow/dropout
- vendor contract tests with recorded small sample
- Even Hub simulator display smoke test

### Benchmark reports

Phase 2 must produce:

- per-vendor median/p95 latency
- WER by noise condition
- diarization notes / label error rate where measurable
- custom vocabulary hit rate
- observed costs/minute
- all tool failures and vendor API errors

---

## 13. Security, privacy, and accounts

Cloud ASR sends live conversation audio to a third-party vendor. This has privacy and lock-in implications.

Approved for benchmark by Tony, but before entering any API key, payment method, or production account:

- document vendor data retention settings
- prefer ephemeral tokens or a local token broker
- do not commit secrets
- log which vendor receives which test audio
- provide visual indication when cloud ASR is active

---

## 14. Phase 2 implementation plan after approval

If Tony approves this architecture, Phase 2 starts with TDD and no G2 hardware dependency:

1. scaffold TypeScript/Vite app and tests
2. define interfaces: `AudioSource`, `AsrClient`, `CaptionState`, `DisplayTransport`
3. implement formatter and visual error states first
4. implement fixture-audio benchmark harness
5. add AssemblyAI client behind interface
6. add Deepgram client behind same interface
7. implement vocabulary correction
8. produce latency/WER/custom-vocab report
9. demo phone/CLI output to Tony
10. STOP for Phase 2 approval

---

## 15. Approval gate

STOP.

Tony must approve this architecture before any production code is written.

Specific approval requested:

1. Approve **Even Hub WebView-first + native fallback** architecture.
2. Approve **AssemblyAI + Deepgram first benchmark**, with Speechmatics third if needed.
3. Approve **stable partials on lens before finals** to meet <=800 ms latency.
4. Approve **vendor diarization first**, with pyannote/NeMo only if vendor labels fail.
5. Approve the proposed repo layout and Phase 2 implementation order.
