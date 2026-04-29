# Phase 2 — Real Speech PCM Fixture Smoke Test

Date: 2026-04-29

## Scope

This step adds a controlled real-speech PCM fixture and streams it through the already-approved AssemblyAI temporary-token WebSocket path.

It still does **not** implement:

- live microphone capture
- G2 SDK audio capture
- BLE writes
- always-on/background capture
- vendor lock-in beyond the AssemblyAI benchmark scaffold

## Fixture

Generated locally from macOS text-to-speech, then converted with `ffmpeg`:

```text
Text: ProvenMachine captions are ready.
PCM: public/fixtures/speech-smoke.pcm
Transcript: public/fixtures/speech-smoke.txt
Sample rate: 16000 Hz
Encoding: pcm_s16le
Channels: 1 mono
Duration: ~1969ms
Bytes: 63006
Chunk size: 100ms
```

The generated AI voice is a transport/ASR smoke fixture, not a natural-noise WER benchmark.

## App UI added

Browser shell now exposes:

```text
Connect AssemblyAI
Stream Silent PCM Fixture
Stream Speech PCM Fixture
Terminate
```

`Stream Speech PCM Fixture` loads `/fixtures/speech-smoke.pcm`, chunks it into 100ms PCM frames, streams it over the open AssemblyAI WebSocket, then sends the AssemblyAI terminate message so the provider emits a final transcript.

## Runtime fixes found during live smoke testing

1. `connect()` now waits for the WebSocket `open` event before reporting `ASR CONNECTED — waiting audio`.
2. `terminate()` now sends the provider terminate message without immediately closing the socket, allowing final transcript/termination messages to arrive.
3. `CaptionState.clear()` resets stale captions on reconnect.
4. Caption state now merges unknown-speaker partials with final diarized segments that share the same start time.
5. App keyterms were narrowed to `ProvenMachine` for this smoke fixture after `Even Realities G2` / `G2 Captions` keyterms caused provider over-insertion in a short TTS clip.

## Live AssemblyAI smoke-test evidence

Instrumented browser run:

```text
connected: 541ms
fixture loaded: 546ms
stream sent: 2553ms
terminate sent: 2553ms
first partial transcript: 1530ms from session start
final transcript: 3374ms from session start
```

Relative to first audio chunk send, first partial was approximately:

```text
1530ms - 546ms = 984ms
```

Observed partial:

```text
ProvenMachine—
```

Observed final:

```text
Speaker: A
Text: ProvenMachine captions are ready.
```

The final transcript matched the fixture text exactly. The first-partial timing did **not** prove the ≤800ms target yet; this is a controlled smoke test, not a tuned latency benchmark.

## Browser shell visual verification

After clicking `Connect AssemblyAI`, then `Stream Speech PCM Fixture`, the rendered shell reached:

```text
G2 CAPTIONS
A: ProvenMachine captions
   are ready.
ASR CLOSED — captions paused
```

Browser console after the verified UI smoke test:

```text
0 console messages
0 JS errors
```

## Verification commands

```bash
npm test
npm run build
evenhub pack app.json dist -o g2-captions.ehpk
```

Latest test/build status at doc creation:

```text
Test Files: 13 passed
Tests: 28 passed
Build: passed
```

## Next gate

STOP before live microphone or G2 SDK audio capture.

Recommended next work, if approved:

1. Add structured latency telemetry around token fetch, WebSocket open, audio first chunk, first partial, final, formatter, and display update.
2. Add a small multi-utterance speech fixture set with expected transcripts.
3. Only then move to browser microphone capture or G2 SDK audio capture with explicit approval and visual permission-failure handling.
