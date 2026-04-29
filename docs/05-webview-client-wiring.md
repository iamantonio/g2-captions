# Phase 2 AssemblyAI WebView Client Wiring

Date: 2026-04-29

## Scope completed

This step wires the browser/WebView side to the local token broker and AssemblyAI WebSocket provider seam. It still does **not** capture live microphone audio and does **not** stream audio chunks yet.

## Implemented behavior

- Fetch temporary token from local broker:
  - `POST http://127.0.0.1:8787/assemblyai/token`
- Open AssemblyAI WebSocket using the existing temporary-token URL builder.
- Include approved keyterms:
  - `ProvenMachine`
  - `Even Realities G2`
  - `G2 Captions`
- Map AssemblyAI `Turn` messages into the shared `RawAsrEvent` caption contract.
- Send explicit AssemblyAI `Terminate` message before closing an open session.
- Render all connection/token/message failures visually:
  - `ASR TOKEN FAILED — check broker`
  - `ASR CONNECTION FAILED — captions paused`
  - `ASR MESSAGE FAILED — captions paused`
  - `ASR CLOSED — captions paused`
- Browser shell now has:
  - `Connect AssemblyAI`
  - `Terminate`

## Files changed

- `src/asr/AssemblyAiLiveSession.ts`
  - client-side live session coordinator.
- `tests/unit/assemblyAiLiveSession.test.ts`
  - TDD coverage for token fetch, WebSocket URL, Turn mapping, terminate behavior, and visual-only failure states.
- `src/app/main.ts`
  - basic browser shell controls and status rendering.

## Verification

```text
npm test
Test Files  10 passed (10)
Tests       20 passed (20)
```

```text
npm run build
✓ built in 47ms
```

```text
evenhub pack app.json dist -o g2-captions.ehpk
Successfully packed g2-captions.ehpk (3389 bytes)
```

## Local smoke-test flow

Terminal 1:

```bash
export ASSEMBLYAI_API_KEY="<local AssemblyAI key>"
npm run token-broker
```

Terminal 2:

```bash
npm run dev -- --port 5173
```

Open the app or simulator, then press/click:

```text
Connect AssemblyAI
```

Expected visual states:

```text
CONNECTING — token
CONNECTING — ASR
ASR CONNECTED — waiting audio
```

At this stage, no audio is sent, so this is a connection/token smoke test only.

## Next gate

Next implementation step is live audio source plumbing. That means choosing which source to wire first:

1. Browser microphone via `getUserMedia` + PCM conversion for local browser smoke testing.
2. Even Hub SDK `audioEvent.audioPcm` once verified on hardware/simulator behavior.
3. Pre-recorded public/Tony clip paced in real time for controlled benchmark.

For safety and debuggability, recommended next step is **pre-recorded/paced PCM fixture into the live WebSocket**, then browser mic, then G2 SDK audio.
