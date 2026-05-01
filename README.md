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
- Structured latency telemetry and visible telemetry JSON
- Multi-utterance fixture benchmark harness with WER-lite, vocabulary, and speaker-label scoring
- Opt-in browser microphone prototype path after approval
- Opt-in G2 SDK audio prototype path after approval
- Lens-style text rendering helper
- Visual-only status and error states
- Test/build/packaging smoke path

Not implemented yet:

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
npm run benchmark:fixtures # generate fixture-only benchmark JSON
npm run hardware:readiness # print LAN QR/probe checklist for G2 smoke testing
npm run token-broker       # local temporary-token broker (requires ASSEMBLYAI_API_KEY)
```

## Live AssemblyAI smoke test

Live cloud ASR requires a local token broker so the browser app receives only temporary streaming tokens.

Terminal 1:

```bash
export ASSEMBLYAI_API_KEY="your_assemblyai_api_key_here"
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

For a `.ehpk` that ships to a real device via the Even Hub portal, the WebView needs to know where to find the broker. Set `VITE_BROKER_BASE_URL` at build time:

```bash
VITE_BROKER_BASE_URL=https://your-broker.fly.dev npm run build
evenhub pack app.json dist -o g2-captions.ehpk
```

For a local Vite dev session, omit the env var — `runtimeConfig.ts` falls back to deriving the broker URL from the LAN IP serving the app, which is what `npm run dev -- --host 0.0.0.0` already produces.

Generated outputs (`dist/`, `*.ehpk`, `artifacts/`) are intentionally ignored.

## Deploying the broker (Fly.io)

The token broker (`tools/token-broker.ts`) is a small Node service that gates the Deepgram + AssemblyAI credentials and proxies the Deepgram WebSocket. For dev, it runs on your Mac on `127.0.0.1:8787`. For shipping, deploy it to Fly.io so an installed `.ehpk` can reach it from anywhere.

First-time setup:

```bash
# 1. Install flyctl (https://fly.io/docs/hands-on/install-flyctl/) and sign in.
fly auth login

# 2. Create the app. Pick a name or let Fly generate one.
fly apps create g2-captions-broker
# Edit fly.toml to uncomment `app = "g2-captions-broker"` so subsequent
# `fly deploy` invocations target the right app without -a.

# 3. Set the credential secrets (read from your local .env).
fly secrets set DEEPGRAM_API_KEY="$(grep '^DEEPGRAM_API_KEY=' .env | cut -d= -f2-)"
fly secrets set VITE_BROKER_AUTH_TOKEN="$(grep '^VITE_BROKER_AUTH_TOKEN=' .env | cut -d= -f2-)"
# Optional, only if you use the AssemblyAI seam:
fly secrets set ASSEMBLYAI_API_KEY="$(grep '^ASSEMBLYAI_API_KEY=' .env | cut -d= -f2-)"

# 4. Deploy.
fly deploy

# 5. Verify the deployed broker answers /healthz with 200 {ok:true}.
curl -fsS https://g2-captions-broker.fly.dev/healthz
```

Subsequent deploys are just `fly deploy`. Logs stream with `fly logs`.

After the broker is up, rebuild the `.ehpk` with `VITE_BROKER_BASE_URL` set to the Fly URL (see Packaging above), upload it via the Even Hub portal at `hub.evenrealities.com/hub`, and the next launch on G2 will reach the deployed broker instead of `127.0.0.1`.

The bearer token (`VITE_BROKER_AUTH_TOKEN`) is now baked into every shipped `.ehpk` — anyone who installs it can extract it from the bundle. The broker's per-IP rate limit (10 token mints/min) is the only abuse cap. For a real ship to users you don't know, plan to layer real per-user auth and tighter caps before opening distribution.

## Documentation

- `docs/00-research.md` — Phase 0 research dossier
- `docs/01-architecture.md` — approved Phase 1 architecture
- `docs/02-prototype-report.md` — fixture prototype report
- `docs/03-assemblyai-scaffold.md` — AssemblyAI provider seam
- `docs/04-token-broker.md` — temporary-token broker
- `docs/05-webview-client-wiring.md` — browser/WebView live session wiring
- `docs/06-pcm-fixture-streaming.md` — paced PCM fixture transport
- `docs/07-speech-pcm-fixture-smoke.md` — real-speech fixture smoke evidence
- `docs/08-latency-telemetry.md` — structured benchmark telemetry
- `docs/09-fixture-benchmark.md` — multi-utterance fixture benchmark
- `docs/10-live-audio-gates.md` — approved browser mic and G2 SDK audio capture gates
- `docs/11-hardware-smoke.md` — hardware/device smoke plan

## Safety gate

Browser microphone and G2 SDK audio paths are now explicit opt-in prototype controls after approval. Do not make continuous-use, background, phone-lock, or Conversate superiority claims until physical hardware benchmark evidence exists.
