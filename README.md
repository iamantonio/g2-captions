# G2 Captions

Accessibility-first real-time captioning prototype for Even Realities G2 smart glasses.

This project is an Even Hub / G2 WebView-first prototype that explores whether a third-party captioning app can beat the built-in Conversate experience on latency, readability, custom vocabulary, and visual-only failure handling.

## Current status

Phase 2 prototype scaffold is active.

Implemented so far:

- Vite + TypeScript + Vitest app scaffold
- Even Hub manifest for G2 Captions
- Fixture ASR client and caption formatter
- AssemblyAI Universal Streaming URL/client seam
- Local AssemblyAI temporary-token broker; API keys stay server-side only
- Browser/WebView wiring for temporary tokens and WebSocket sessions
- Deterministic silent PCM fixture streaming
- Real speech PCM smoke fixture streaming
- Lens-style text rendering helper
- Visual-only status and error states
- Test/build/packaging smoke path

Not implemented yet:

- Live microphone capture
- G2 SDK audio capture
- BLE writes
- always-on/background capture
- production benchmark claims versus Conversate

## Non-negotiables

- Deaf-first UX: no sound-only prompts, errors, or permission states.
- Every audio, network, ASR, and provider failure must be visually surfaced.
- API keys must never be embedded in the WebView or committed to files.
- Conversate is the product floor, but superiority must be measured before claimed.
- BLE writes outside the official Even Hub SDK require a separate safety gate.

## Requirements

- Node.js 20 LTS or 22+
- npm
- Even Hub CLI/simulator for packaging or simulator work:

```bash
npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator
```

## Setup

```bash
npm install
cp .env.example .env
# Fill ASSEMBLYAI_API_KEY locally only if running live AssemblyAI smoke tests.
```

## Scripts

```bash
npm test          # run Vitest suite
npm run build     # type-check and build
npm run prototype # run fixture-only prototype from Node
npm run token-broker # start local AssemblyAI temporary-token broker
```

## Live AssemblyAI smoke test

Live cloud ASR requires a local token broker so the browser app receives only temporary streaming tokens.

Terminal 1:

```bash
export ASSEMBLYAI_API_KEY="..."
npm run token-broker
```

Terminal 2:

```bash
npm run dev -- --port 5173
```

Then open the local app and use:

1. `Connect AssemblyAI`
2. `Stream Speech PCM Fixture`
3. `Terminate` if needed

This uses a controlled local PCM fixture, not live microphone or G2 audio.

## Packaging

```bash
npm run build
evenhub pack app.json dist -o g2-captions.ehpk
```

Generated outputs (`dist/`, `*.ehpk`, `artifacts/`) are intentionally ignored.

## Documentation

- `docs/00-research.md` — Phase 0 research dossier
- `docs/01-architecture.md` — approved Phase 1 architecture
- `docs/02-prototype-report.md` — fixture prototype report
- `docs/03-assemblyai-scaffold.md` — AssemblyAI provider seam
- `docs/04-token-broker.md` — temporary-token broker
- `docs/05-webview-client-wiring.md` — browser/WebView live session wiring
- `docs/06-pcm-fixture-streaming.md` — paced PCM fixture transport
- `docs/07-speech-pcm-fixture-smoke.md` — real-speech fixture smoke evidence

## Safety gate

The current next gate is to stop before live microphone or G2 SDK audio capture. The next safe step is structured latency telemetry and a small multi-utterance fixture set.
