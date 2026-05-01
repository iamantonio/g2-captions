# Phase 13 — First hardware run on G2

Date: 2026-05-01
Status: Speech-fixture path verified end-to-end on real G2 hardware. Live
G2 SDK mic path and manual observations (latency, speaker labels, phone
lock) still pending.

## Build under test

- Branch: `main` at commit [`48c4994`](../README.md) (Wave 3 fix #41 —
  partial-render throttle, immediate finals).
- WebView refactored into `UIShell` / `ASRController` / `AudioController`
  / `TelemetryReporter` (Wave 3 fix #37) with happy-dom unit + smoke
  tests (Wave 3 fix #38). 163/163 tests green at build time.
- Build artifact: `g2-captions.ehpk` (96 KB), packed from `dist/` after
  `npm run build` with `VITE_BROKER_AUTH_TOKEN` baked in.

## Run setup

Per `docs/11-hardware-smoke.md`:

```bash
# Terminal 1 — broker on LAN
set -a && . ./.env && set +a && HOST=0.0.0.0 npm run token-broker

# Terminal 2 — Vite on LAN
npm run dev -- --host 0.0.0.0 --port 5173

# QR with auto-smoke consent flag
evenhub qr --url "http://<lan-ip>:5173?autoSmoke=1"
```

`.env` contained `DEEPGRAM_API_KEY` and a freshly generated 32-byte hex
`VITE_BROKER_AUTH_TOKEN` (gitignored, never committed).

## What was verified

The lens showed `SMOKE OK` after the auto-smoke fixture flow completed,
which implies every step in the pipeline succeeded — any earlier failure
would have surfaced a different visual state (deaf-first contract):

1. **WebView bundle loaded** inside Even Hub from the LAN Vite server.
2. **`waitForEvenAppBridge()` resolved** → SDK bridge ready, lens
   container created via `CreateStartUpPageContainer`.
3. **Auto-smoke consent gate fired** — the `?autoSmoke=1` query flag was
   honored by `shouldAutoRunHardwareSmoke` (Wave 1 fix #19).
4. **WebView reached the LAN token broker** at `http://<lan-ip>:8787`.
   This is the headline finding — see "Spike #18 closure" below.
5. **Pre-shared bearer token (Wave 2 fix #34) authenticated** the
   WebView's `/deepgram/token` POST and the `/deepgram/listen` WS
   upgrade. Loopback exemption was not exercised; LAN path verified.
6. **Deepgram WebSocket opened** through the broker proxy with the
   server-side fixed parameter set (Wave 2 fix #36).
7. **Speech fixture loaded** from the Vite-served `fixtures/` directory
   over LAN.
8. **PCM streamed and ASR terminated cleanly** — the close status
   `SMOKE COMPLETE — captions verified` propagated through to the lens
   and rendered as footer `SMOKE OK` (per
   `src/captions/formatter.ts`).
9. **G2 lens display path works** — `G2LensDisplay` startup and
   `textContainerUpgrade` both succeeded (otherwise the warning row in
   `UIShell.renderLens` would have appeared).

## Spike #18 closure (manifest network whitelist)

`docs/12-manifest-whitelist-spike.md` asked whether Even Hub enforces the
`app.json` `permissions[].whitelist` for the WebView's outbound calls.
Result: **the whitelist is permissive for loopback / LAN** (Outcome 1
in the spike doc).

`app.json` only lists `https://api.deepgram.com`, but the WebView
reached `http://<lan-ip>:8787/deepgram/token` and
`ws://<lan-ip>:8787/deepgram/listen` without intervention. Spike closes
with no manifest change required at this time. The whitelist still
documents the broker's actual upstream and is kept as advisory /
contractual rather than enforced.

## Still NOT verified by this run

The fixture path is _playback streaming_ — it does not exercise the
live G2 microphone. The following remain as Phase 3 observation gaps:

- **`Start G2 SDK Audio` button** — `bridge.audioControl(true)` plus
  `audioEvent.audioPcm` ingestion. Different code path
  (`src/audio/g2SdkAudio.ts`); unverified on hardware.
- **First-partial latency** from the telemetry JSON `<details>` panel
  on the phone shell.
- **Final-transcript latency** from the same panel.
- **Speaker label behavior** with multiple voices.
- **Phone lock / background behavior** (project's hardest unclaimed
  surface).
- **Continuous-use / daily-driver behavior** — explicitly not claimed
  per CLAUDE.md non-negotiables; would need a separate Tony approval
  gate to attempt.

## Manual observations to record next

Capture before closing Phase 3:

- G2 firmware/device version
- Even Hub app version
- Phone model / OS version
- The five `metrics` fields from the telemetry JSON
- Whether `audioEvent.audioPcm` arrives continuously when
  `Start G2 SDK Audio` is tapped
- Any lens-visible error state during the live-mic test
