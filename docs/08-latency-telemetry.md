# Phase 2.1 — Structured Latency Telemetry

Date: 2026-04-29

## Scope completed

This step adds structured telemetry for the controlled AssemblyAI PCM fixture path before any live microphone or G2 SDK audio capture.

It still does **not** implement:

- browser microphone capture
- G2 SDK audio capture
- BLE writes
- always-on/background capture
- production claims against Conversate

## Implemented behavior

A benchmark telemetry recorder now captures ordered JSON-safe events and derived metrics for the speech fixture smoke path.

Recorded event stages include:

```text
token_request_start
token_request_end
websocket_open
first_audio_chunk_sent
final_audio_chunk_sent
provider_terminate_sent
first_partial_received
final_transcript_received
caption_formatted
display_update_sent
websocket_closed
websocket_error
```

The recorder computes metrics when enough events exist:

```text
tokenRequestMs
websocketOpenFromStartMs
firstPartialFromFirstAudioMs
finalTranscriptFromFirstAudioMs
displayUpdateFromFinalTranscriptMs
```

The browser/WebView shell renders the latest report under a visible `Telemetry JSON` details panel so benchmark evidence is available without relying on console logs or audio-only feedback.

## Files changed

- `src/captions/latency.ts`
  - Adds `createBenchmarkTelemetryRecorder()` and JSON-safe report types.
- `src/asr/AssemblyAiLiveSession.ts`
  - Emits telemetry for token, WebSocket, PCM chunk, provider terminate, and transcript events.
- `src/app/main.ts`
  - Wires telemetry into the AssemblyAI smoke path and renders the latest report visually.
- `tests/unit/latency.test.ts`
  - Covers ordered event capture and metric calculation.
- `tests/unit/assemblyAiLiveSession.test.ts`
  - Covers telemetry emission from the AssemblyAI live session seam.

## Verification

```text
npm test
Test Files  16 passed (16)
Tests       43 passed (43)
```

```text
npm run build
✓ built in 204ms
```

```text
evenhub pack app.json dist -o g2-captions.ehpk
Successfully packed g2-captions.ehpk
```

## Next gate

Recommended next step: Phase 2.2 multi-utterance fixture benchmark.

Still stop before:

- live browser microphone capture
- G2 SDK audio capture
- BLE writes
- always-on/background capture
