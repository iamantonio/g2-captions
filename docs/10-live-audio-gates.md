# Phase 2.3 / 2.4 — Approved Live Audio Gates

Status: implemented as explicit, opt-in prototype paths after fixture telemetry and fixture benchmark baselines.

## Scope

Antonio approved crossing the next gates after Phase 2.1 telemetry and Phase 2.2 fixture benchmarking. This phase adds live audio source adapters while keeping all failures visual and preserving the temporary-token broker boundary.

Implemented live sources:

1. Browser microphone capture
2. Even Hub / G2 SDK `audioControl(true)` + `audioEvent.audioPcm`

Still not claimed:

- no Conversate superiority claim
- no continuous daily-driver claim
- no phone-lock/background claim
- no BLE writes
- no raw API key in WebView

## Browser microphone path

UI button:

```text
Start Browser Mic
```

Visual states include:

- `BROWSER MIC PERMISSION — waiting`
- `BROWSER MIC LIVE — captions streaming`
- `BROWSER MIC DENIED — captions paused`
- `BROWSER MIC STREAM FAILED — captions paused`
- `BROWSER MIC STOPPED — captions paused`

Implementation:

- requests `navigator.mediaDevices.getUserMedia({ audio: ... })`
- converts browser `Float32` audio frames to `16kHz` `pcm_s16le`
- sends live PCM chunks through the existing AssemblyAI temporary-token WebSocket session
- keeps token broker as the only credential boundary

## G2 SDK audio path

UI button:

```text
Start G2 SDK Audio
```

Visual states include:

- `G2 MIC STARTING — waiting audio`
- `G2 MIC LIVE — captions streaming`
- `G2 MIC FAILED — captions paused`
- `G2 MIC STREAM FAILED — captions paused`
- `G2 MIC STOPPED — captions paused`
- `G2 MIC FAILED — bridge unavailable`

Implementation:

- stores the Even Hub bridge after `waitForEvenAppBridge()`
- calls `bridge.audioControl(true)` only after a startup bridge exists
- listens for `event.audioEvent.audioPcm`
- forwards PCM bytes to the existing AssemblyAI WebSocket session
- calls `bridge.audioControl(false)` on stop

## Termination and billing boundary

The existing `Terminate` control still sends the AssemblyAI terminate message through the session and stops any active live audio source. This keeps the billing/session boundary explicit and visible.

## Verification

Focused tests added:

```bash
npm test -- tests/unit/browserMicrophone.test.ts tests/unit/g2SdkAudio.test.ts tests/unit/assemblyAiLiveSession.test.ts
```

Full release gate remains:

```bash
npm test
npm run benchmark:fixtures
npm run build
evenhub pack app.json dist -o g2-captions.ehpk
```

## Hardware observation gap

This implementation makes the SDK audio path ready for hardware testing, but actual G2 observations still require running the app in Even Hub with glasses connected and recording:

- device/app versions
- whether `audioEvent.audioPcm` arrives continuously
- latency from G2 PCM to first/final captions
- behavior on phone lock/background
- lens-visible failures
