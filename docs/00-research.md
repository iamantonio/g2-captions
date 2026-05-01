# G2-Captions Phase 0 Research Dossier

Date: 2026-04-29  
Operator: Tony  
Mission: daily-driver real-time captioning for Even Realities G2, accessibility-first, measurably better than Conversate.

## Status

Phase 0 research is complete enough to expose the main architecture decisions and unknowns. No production code was written.

**Gate:** STOP after this document. Tony approval is required before Phase 1 architecture.

---

## 1. Hard product floor: Conversate

### Officially documented capabilities

Conversate is a G2 core feature that provides real-time conversation analysis, AI cues, prep notes, live transcript display, session history, action items, and export support. Sources:

- Even support Conversate docs: https://support.evenrealities.com/hc/en-us/articles/14273795154319-Conversate
- Apple App Store listing: https://apps.apple.com/ca/app/even-realities/id6747017725
- Google Play listing: https://play.google.com/store/apps/details?id=com.even.sg&hl=en_US
- Even product page: https://www.evenrealities.com/smart-glasses

Conversate UI is documented as three areas: Prep Notes, AI Cues, and Transcripts; transcript appears at the bottom of the glasses display. Source: https://support.evenrealities.com/hc/en-us/articles/14273795154319-Conversate

Conversate supports speech languages including Chinese, Czech, Danish, Dutch, English, Finnish, French, German, Greek, Hungarian, Indonesian, Italian, Japanese, Korean, Norwegian, Polish, Portuguese, Spanish, Swedish, and Turkish. Source: https://support.evenrealities.com/hc/en-us/articles/14273795154319-Conversate

Conversate voice input can be set to **Glasses Mic** or **Phone Mic**; language must be set before a session and cannot be changed during an active session. Source: https://support.evenrealities.com/hc/en-us/articles/14273795154319-Conversate

Conversate requires internet connection and G2 Bluetooth connectivity to the phone. Source: https://support.evenrealities.com/hc/en-us/articles/14273795154319-Conversate

### Publicly evidenced gaps

No official WER, speaker-label accuracy, custom vocabulary hit-rate, or latency benchmark methodology was found in public official docs, app stores, or extracted community sources.

Public issues found:

- App Store reviewer reports “significant delay at times between what is said and what is displayed.” Source: https://apps.apple.com/us/app/even-realities/id6747017725?see-all=reviews&platform=iphone
- App Store reviewer reports Conversate pop-ups lasting 5 seconds can be too short to read. Source: https://apps.apple.com/us/app/even-realities/id6747017725?see-all=reviews&platform=iphone
- HearingTracker G2 user report says no speaker identification was present; Even reportedly indicated it was planned for future update. Community source, not official: https://forum.hearingtracker.com/t/even-realities-review/111040
- HearingTracker G2 user report says clip-on lenses were essential outdoors because sun glare made text hard to read. Community source: https://forum.hearingtracker.com/t/even-realities-review/111040
- HearingTracker G1 report says transcription worked best in direct conversation without background noise and degraded with distance/noise. **[unverified for G2/current Conversate]** Source: https://forum.hearingtracker.com/t/speach-transcription-with-my-new-evenrealities-g1-smartglasses/93246

### Conversate floor for G2-Captions

G2-Captions must at least match:

- live captions on lens
- phone/glasses mic selection, if SDK access allows
- session history/export equivalent, later phase
- visual-only state/errors
- reliable Bluetooth/app connectivity behavior

G2-Captions should exceed Conversate on:

- measured end-to-end latency, not marketing latency
- noisy-environment WER
- explicit speaker labels
- explicit custom vocabulary
- Tony-tuned readability settings

---

## 2. Even Realities G2 hardware and SDK facts

### Display and device specs

Official Even support specs list:

- Optics: waveguides
- Ocularity: binocular
- Resolution: 640 × 350
- FoV: 27.5°
- Refresh rate: 60 Hz
- Brightness: 1200 nits
- Display: Micro LED
- Display color: green
- Four microphones
- Bluetooth: BLE 5.4
- Eyewear battery: 192 mAh / 0.744 Wh
- Case battery: 2000 mAh / 7.4 Wh
- Battery life: regular use for 2 days
- IP65 water/dust resistance

Source: https://support.evenrealities.com/hc/en-us/articles/13499229138959-Specs

Official Even Hub docs list a different developer-display spec:

- Display: 576 × 288 pixels per eye
- Color depth: 4-bit greyscale / 16 green shades
- Connectivity: Bluetooth 5.2
- Audio input: 4-mic array, single audio stream, 16 kHz PCM
- Touchpads: press, double press, swipe up, swipe down
- Camera / speaker: none
- App logic runs on phone; glasses handle display rendering and native scroll processing

Source: https://hub.evenrealities.com/docs

**Open discrepancy:** public support specs say 640 × 350 and BLE 5.4; Even Hub developer docs say 576 × 288 per eye and BLE 5.2. For app development, use the Even Hub SDK/display container coordinate system until hardware tests prove otherwise. Do not treat either as sufficient for Tony readability without physical testing.

### Official SDK / app model

Even Hub apps are WebView plugins built with standard web technologies and `@evenrealities/even_hub_sdk`; app logic runs on the phone and communicates with the Even app bridge. Source: https://hub.evenrealities.com/docs

The npm SDK page states `@evenrealities/even_hub_sdk` is a TypeScript SDK for WebView developers to communicate with the Even App, with device info, local storage, protocol calls, glasses UI creation, audio/IMU control, and real-time event listening. Source: https://www.npmjs.com/package/@evenrealities/even_hub_sdk

SDK version observed publicly: `0.0.10`; Node requirement listed as `^20.0.0 || >=22.0.0`. Source: https://www.npmjs.com/package/@evenrealities/even_hub_sdk

Even Hub workflow: local preview with `evenhub-simulator`, sideload/private build, package with `evenhub pack app.json dist -o myapp.ehpk`, submit `.ehpk`. Source: https://hub.evenrealities.com/docs

### Audio path exposed to developers

Official Even Hub docs say the hardware has a 4-mic array exposed as a single 16 kHz PCM audio stream. Source: https://hub.evenrealities.com/docs

The npm SDK page says host-pushed audio is delivered as `audioEvent` in `onEvenHubEvent`, with PCM bytes in `event.audioEvent.audioPcm`. Source: https://www.npmjs.com/package/@evenrealities/even_hub_sdk

A third-party SDK verification article reports `bridge.audioControl(micOn)` and receiving PCM audio through audio events in a Vite/TypeScript app on simulator and real G2 hardware. Community source: https://zenn.dev/bigdra/articles/eveng2-sdk-features?locale=en

The older official `EvenDemoApp` repository for G1 documents microphone activation via Bluetooth and receiving a real-time audio stream in LC3 format with a 30-second maximum recording duration for Even AI. This is G1/demo/protocol-level information and **[unverified for Even Hub G2 plugin apps]**. Source: https://github.com/even-realities/EvenDemoApp

**Critical unknown for Phase 1:** whether Even Hub G2 plugin audio can run continuously enough for daily-driver captions, or whether audio capture is session/gesture-limited, app-foreground-limited, or subject to app review restrictions. This must be tested before committing to a G2-mic-first architecture.

### Community SDKs / protocol work

`i-soxi/even-g2-protocol` documents reverse-engineered G2 BLE protocol, custom packets, authentication, teleprompter display, CRC-16/CCITT, and channel concepts. This is community reverse-engineering and should not be used for firmware-affecting BLE writes without Tony approval. Source: https://github.com/i-soxi/even-g2-protocol

The repo states the G2 uses a custom BLE protocol and includes examples for displaying custom text. Source: https://github.com/i-soxi/even-g2-protocol

`BxNxM/even-dev` is a community multi-app Even Hub Simulator development environment and lists sample apps including `stt`. Source: https://github.com/BxNxM/even-dev

**Safety gate:** Any BLE write pattern outside official Even Hub SDK display/audio APIs requires Tony approval before implementation.

---

## 3. ASR landscape for target metrics

Target: ≤800 ms spoken word → glyph rendered on lens. Vendor transcription latency is only one part of the budget; phone capture, chunking, encoding, network, ASR partial/final, diarization, custom-vocab correction, formatter, SDK/BLE rendering, and display refresh must all fit.

### Hosted ASR candidates

| Option                               |                                                                                                             Latency evidence | Diarization                                                                                                  | Custom vocab                                                                       |                                                  Cost evidence | Main tradeoff                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------: | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------: | ----------------------------------------------------------------------------------- |
| Deepgram Nova-3 / Flux               |                                                                             Vendor claims real-time transcripts under 300 ms | Streaming diarization via `diarize=true`                                                                     | Keyterm prompting up to 100 terms                                                  |                                   Nova-3/Flux $0.0077/min PAYG | Strong latency/keyterm candidate; noisy G2 WER unverified                           |
| AssemblyAI Universal-3 Pro Streaming |                                                    Docs claim sub-300 ms time-to-complete transcript latency for `u3-rt-pro` | Streaming diarization on all streaming models; `speaker_labels=true`; short turns under ~1s may be `UNKNOWN` | Keyterms up to 100, dynamic updates                                                |                U3 Pro streaming $0.45/hr; diarization $0.12/hr | Best documented latency + diarization + dynamic keyterms; must benchmark real noise |
| Speechmatics Real-Time               | Claims 90%+ accuracy with <1s latency; partials in few hundred ms; some docs caveat final can be up to 2s depending settings | Real-time speaker, channel, and channel+speaker diarization                                                  | Custom dictionary up to 1000 words/phrases with `sounds_like`                      |                           Pro real-time starts around $0.24/hr | Strong diarization/custom dictionary/cost; ≤800 ms final path needs proof           |
| OpenAI Realtime / GPT-4o Transcribe  |                                                 Realtime API intended for low-latency audio; exact caption latency not found | File diarization exists for `gpt-4o-transcribe-diarize`; realtime diarization unverified                     | Prompting exists for `gpt-4o-transcribe`; diarize model prompt support not present | Token-based; effective per-minute live-caption cost unverified | Strong model ecosystem; realtime diarization/custom-vocab path unclear              |

Sources:

- Deepgram STT: https://deepgram.com/product/speech-to-text
- Deepgram pricing: https://deepgram.com/pricing
- Deepgram diarization: https://developers.deepgram.com/docs/diarization
- Deepgram keyterm prompting: https://developers.deepgram.com/docs/keyterm-prompting
- AssemblyAI U3 Pro Streaming: https://www.assemblyai.com/docs/speech-to-text/streaming/universal-3-pro
- AssemblyAI pricing: https://www.assemblyai.com/pricing
- AssemblyAI streaming diarization: https://assemblyai.com/docs/streaming/label-speakers-and-separate-channels
- AssemblyAI keyterms: https://www.assemblyai.com/docs/streaming/keyterms-prompting
- Speechmatics Real-Time: https://www.speechmatics.com/product/real-time
- Speechmatics pricing: https://www.speechmatics.com/pricing
- Speechmatics realtime diarization: https://docs.speechmatics.com/speech-to-text/realtime/realtime-diarization
- Speechmatics custom dictionary: https://docs.speechmatics.com/speech-to-text/features/custom-dictionary
- OpenAI speech-to-text docs: https://developers.openai.com/api/docs/guides/speech-to-text
- OpenAI pricing: https://openai.com/api/pricing/

### On-device / offline candidates

| Option                    | Evidence                                                                                     | Strength                               | Risk                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| Whisper.cpp               | Cross-platform local Whisper implementation; model RAM requirements vary heavily by model    | Offline/privacy/cost                   | No built-in diarization; mobile latency/battery/thermal uncertain          |
| WhisperKit / MLX on Apple | WhisperKit paper claims 0.46s latency and 2.2% WER in its benchmark                          | Strong Apple-device offline candidate  | Apple-only OSS path; diarization/custom vocabulary weaker than hosted APIs |
| Apple Speech framework    | Live audio recognition on iOS; supports custom language model data and custom pronunciations | Native iOS, possible custom vocabulary | Apple service/offline behavior and diarization not enough for target alone |

Sources:

- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- WhisperKit: https://github.com/argmaxinc/WhisperKit
- WhisperKit paper: https://arxiv.org/html/2507.10860v1
- Apple live speech recognition: https://developer.apple.com/documentation/Speech/recognizing-speech-in-live-audio

### Preliminary ASR benchmark shortlist

This is **not** a vendor commitment. Tony approval required before using API keys, accounts, payment methods, or committing to cloud dependency.

1. AssemblyAI Universal-3 Pro Streaming — strongest docs match for low latency + streaming diarization + dynamic keyterms.
2. Deepgram Nova-3 Streaming — strong latency/cost/keyterm candidate.
3. Speechmatics Real-Time — strongest custom dictionary size and diarization posture; latency needs measurement.
4. WhisperKit iOS track — offline/privacy fallback candidate if Tony accepts Apple-first constraints.

---

## 4. Diarization landscape

| Option                                                            | Evidence                                                                                                                                | Fit                                                               | Risk                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Vendor built-in diarization: AssemblyAI / Deepgram / Speechmatics | All document real-time/streaming diarization support                                                                                    | Lowest integration complexity; direct labels in transcript stream | Label stability in short overlapping turns must be benchmarked |
| pyannote.audio / pyannoteAI                                       | Open-source PyTorch speaker diarization toolkit; pyannoteAI claims real-time diarization under 150 ms / sub-100 ms                      | Strong dedicated diarization layer; can augment ASR               | Extra service/model path adds latency and complexity           |
| NVIDIA NeMo Streaming Sortformer                                  | NVIDIA docs describe online/streaming Sortformer diarizer; blog says real-time speaker labels for 2–4+ speakers and up to four speakers | Powerful self-hosted/GPU path                                     | Not phone-native; likely backend/GPU operational burden        |

Sources:

- pyannote.audio GitHub: https://github.com/pyannote/pyannote-audio
- pyannoteAI: https://www.pyannote.ai/
- NVIDIA NeMo diarization docs: https://docs.nvidia.com/nemo/speech/nightly/asr/speaker_diarization/models.html
- NVIDIA Streaming Sortformer blog: https://developer.nvidia.com/blog/identify-speakers-in-meetings-calls-and-voice-apps-in-real-time-with-nvidia-streaming-sortformer/

Phase 1 recommendation to evaluate, not implement: prefer ASR vendor built-in diarization for first latency benchmark; keep pyannote/NeMo as fallback if built-in labels fail Tony’s 2-speaker readability needs.

---

## 5. Phone platform comparison

### iOS

Apple’s Speech live-audio sample uses `SFSpeechRecognizer`, `SFSpeechAudioBufferRecognitionRequest`, `AVAudioSession`, and `AVAudioEngine` to capture live microphone audio and continuously update recognized text. Source: https://developer.apple.com/documentation/Speech/recognizing-speech-in-live-audio

Apple’s sample shows custom language model data, exact phrases, templates, and custom pronunciations through `SFCustomLanguageModelData`. Source: https://developer.apple.com/documentation/Speech/recognizing-speech-in-live-audio

The sample requires physical iOS/iPadOS device, not Simulator. Source: https://developer.apple.com/documentation/Speech/recognizing-speech-in-live-audio

**iOS advantages:** likely Tony daily-driver phone environment if he uses iPhone **[unverified]**, mature native audio, Apple Speech custom LM option, WhisperKit on-device path.

**iOS risks:** background microphone/network behavior for always-on captioning requires app entitlement/UX testing; Even Hub plugin apps run in the Even app WebView, so native iOS audio control may not be available inside the plugin. **[unverified until tested]**

### Android

Android 14+ requires foreground services to declare service types. `microphone` and `connectedDevice` are among available foreground service types; Android checks type declarations, permissions, and runtime prerequisites. Sources:

- https://developer.android.com/about/versions/14/changes/fgs-types-required
- https://developer.android.com/develop/background-work/services/fgs/service-types

Android `connectedDevice` foreground service type covers Bluetooth/external-device interaction, requiring related Bluetooth/runtime prerequisites such as `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE`, or `BLUETOOTH_SCAN`. Source: https://developer.android.com/develop/background-work/services/fgs/service-types

**Android advantages:** explicit foreground service path for microphone + connected device; easier long-running service model than iOS in some cases **[requires prototype validation]**.

**Android risks:** Tony’s actual phone/platform unknown; official Even Hub plugin path may abstract native services; BLE/display integration may still be constrained by Even app review and SDK.

### Platform decision for Phase 1

Do not commit yet. Phase 1 must decide between:

1. **Even Hub WebView-first prototype**: fastest path to G2 display/audio if SDK audio is continuous enough.
2. **Native phone app + official SDK/display bridge where possible**: more control over audio/background, but may not be compatible with Even Hub distribution.
3. **Android native research prototype**: best for background mic/BLE experiments, but may not match Tony’s daily phone.

Tony approval required before choosing platform.

---

## 6. Measurement plan required before architecture

### Latency

Measure spoken word → glyph rendered on lens, not API response time.

Proposed instrumentation for Phase 2/3:

- local audio fixture with known timestamps
- phone capture timestamp
- first partial timestamp
- diarized partial/final timestamp
- formatter timestamp
- SDK/BLE write timestamp
- lens screenshot/photodiode/high-speed-camera timestamp **[method TBD]**

### WER in noise

Need Tony-supplied or public test recordings:

- restaurant/café
- party/overlapping speech
- multi-speaker meeting
- car/road noise
- accents if relevant
- Tony custom vocabulary list: names, jargon, slang

If Tony does not supply recordings, use public datasets for initial benchmark and mark them as non-representative.

### Speaker labels

Benchmark at least:

- 2-speaker alternating turns
- short backchannels
- interruptions/overlap
- 3+ speaker stress test

### Lens readability

Must be tested on Tony wearing G2:

- line length
- scroll speed
- number of visible lines
- speaker label style
- partial vs final text behavior
- glare / outdoor readability
- visual error states

---

## 7. Phase 0 blockers / unknowns

1. **Continuous G2 mic access through Even Hub SDK is unproven.** Docs say 16 kHz PCM audio stream is exposed; daily-driver continuous captioning behavior still must be tested.
2. **Conversate exact ASR provider, WER, and latency are not public.** We can only benchmark against measured behavior on Tony’s device.
3. **Realtime diarization quality in noisy short-turn conversation is unknown across all vendors.** Vendor claims are not enough.
4. **Cloud dependency is likely required to hit accuracy and diarization targets quickly.** Tony approval required before committing to cloud ASR.
5. **Offline fallback that meets all metrics is unlikely in V1.** WhisperKit/Whisper.cpp may provide degraded/offline captions but diarization/custom-vocab targets are at risk.
6. **BLE protocol reverse-engineering exists but should not be used for firmware-affecting write patterns without explicit approval.**

---

## 8. Tool-use log

- `skill_view(even-hub-g2-app-development)`: loaded Even Hub/G2 SDK workflow and known constraints.
- `skill_view(writing-plans)`: loaded planning discipline; no production code before approval.
- `skill_view(separate-project-sandboxing)`: loaded repo-boundary rule; new app workspace created under `~/Dev/EvenApps/g2-captions`.
- `todo`: created Phase 0 task tracker.
- `terminal`: created `~/Dev/EvenApps/g2-captions/{docs,src,tests}`. No production code written.
- `delegate_task`: launched parallel research agents for G2 hardware/SDK, Conversate audit, and ASR vendors.
  - G2 hardware/SDK research agent timed out after 600s; failure surfaced here and supplemented with direct searches/extracts.
  - Conversate audit completed with cited findings and extraction failures marked.
  - ASR vendor research completed with cited tradeoff matrix.
- `web_search`: searched Even G2 specs, Even Hub SDK audio, AugmentOS/community SDKs, BLE protocol, pyannote, NeMo, iOS/Android background audio docs.
- `web_extract`: extracted official Even support specs, Even Hub docs, npm SDK page, EvenDemoApp, even-g2-protocol, Zenn SDK verification, pyannote, NeMo, Apple Speech, and Android foreground service docs.
- `terminal(date)`: recorded current date as 2026-04-29.
- `write_file`: wrote this Phase 0 research dossier.

### Tool failures / limitations

- G2 hardware/SDK subagent timed out; no silent skip.
- Reddit extraction failed in Conversate audit; snippet-only claims are marked `[unverified]`.
- Apple AVAudioSession category pages extracted as “page not found”; Apple Speech live-audio sample extracted successfully and was used instead.
- Some vendor pages are marketing-heavy; vendor claims are cited but not treated as measured proof.

---

## 9. Approval gate

STOP.

Tony approval required before Phase 1 architecture. Specific approvals needed next:

1. Which phone platform should Phase 1 prioritize for architecture: Even Hub WebView-first, iOS-native-first, Android-native-first, or dual-track?
2. Is cloud ASR acceptable for the benchmark prototype, knowing it affects privacy, cost, and offline use?
3. Should Phase 1 include reverse-engineered BLE protocol as a fallback research path, or official Even Hub SDK only?
4. Can Tony supply noisy audio samples and a custom vocabulary list for benchmark design?
