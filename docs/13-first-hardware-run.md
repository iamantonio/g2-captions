# Phase 13 — First hardware run on G2

Date: 2026-05-01
Status: Speech-fixture path AND live G2 SDK mic path both verified
end-to-end on real G2 hardware in the same session. Two telemetry bugs
surfaced and were fixed in the same commit. Multi-speaker diarization
and phone-lock / background behavior still pending.

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

## Live G2 SDK mic — second test, 2026-05-01

After the auto-smoke fixture terminated, tapping `Start G2 SDK Audio`
triggered a fresh ASR session (`fixtureId: g2-sdk-audio`). Two phrases
were spoken; both produced partials AND a final, both labeled
`speaker: "0"` by Deepgram. Lens captions appeared in real time during
the long phrase.

### Captured transcripts

| Spoken                                         | First partial                                                              | Final                                          | Speaker |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- | ------- |
| "Testing."                                     | "Testing."                                                                 | "Testing."                                     | 0       |
| "The quick brown fox jumps over the lazy dog." | "The quick" → "The quick brown fox" → "The quick brown fox jumps over the" | "The quick brown fox jumps over the lazy dog." | 0       |

### Measured timings (from raw telemetry events)

| Measurement                                  | Value        | Notes                                                                                 |
| -------------------------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| WebSocket open from token request            | 53 ms        | broker proxy + bearer-token auth, all over LAN                                        |
| "Testing." first partial → final             | 534 ms       | end-of-speech detection + stabilization for one-word utterance                        |
| "The quick brown fox…" first partial → final | 3,490 ms     | 4 partials over 2.1 s, then final; consistent with Deepgram VAD on a long utterance   |
| Partial cadence on long phrase               | ~1.0 s apart | Comfortably above Wave 3 fix #41's 150 ms throttle window — every partial rendered    |
| Session duration (token start → WS closed)   | 64 s         | Long tail (~28 s) between final and Stop tap is just the user not pressing the button |

### What this verified

- **`bridge.audioControl(true)` + `audioEvent.audioPcm` path works on
  real G2 hardware.** Captions appeared from live G2 mic input — not
  fixture playback — for the first time.
- **Deepgram speaker labels flow through.** Numeric `0` (Deepgram's
  scheme) was assigned and propagated to the lens via `CaptionState`
  and the chip formatter without breakage.
- **Multi-partial render flow under fix #41.** The three partials of
  the long phrase arrived ~1 s apart and each rendered, then the final
  flushed synchronously — the throttle window (150 ms) never collapsed
  any of them because real ASR partials are spaced much further apart
  than the window. The throttle's bounded-rate guarantee holds for
  hypothetical bursty providers without affecting today's traffic.

### Bugs surfaced by this run (fixed in the same commit)

- **Bug A — `displayUpdateFromFinalTranscriptMs: -534`** (negative).
  `calculateBenchmarkTelemetryMetrics` picked the _first_
  `display_update_sent` in the session, but `display_update_sent` fires
  for partials too — so it always beat the first final by definition.
  Fixed: pick the first `display_update_sent` whose `atMs >=` the first
  final's `atMs`.
- **Bug B — `firstPartialFromFirstAudioMs` and
  `finalTranscriptFromFirstAudioMs` missing.** `DeepgramLiveSession`
  and `AssemblyAiLiveSession` only emitted `first_audio_chunk_sent`
  inside `streamPcmChunks`, not `sendPcmChunk` — so the per-chunk live
  audio path never produced the latency anchor. Fixed: track per-session
  state and emit on the first `sendPcmChunk` call too.

### Telemetry rerun expected

After the bug-fix commit, a follow-up live-mic run should produce real
numbers for `firstPartialFromFirstAudioMs` (the headline metric for
the 800 ms latency budget) and a non-negative
`displayUpdateFromFinalTranscriptMs` (rendering lag, expected near 0).

## Still NOT verified

- **Speaker diarization with multiple voices** — only one speaker
  present in this run.
- **End-to-end speech → glyph latency** — was unrecoverable from this
  run's telemetry due to Bug B.
- **Phone lock / background behavior** — project's hardest unclaimed
  surface.
- **Continuous-use / daily-driver behavior** — explicitly not claimed
  per CLAUDE.md non-negotiables; would need a separate Tony approval
  gate to attempt.

## Manual observations to capture next run

- G2 firmware/device version
- Even Hub app version
- Phone model / OS version
- `firstPartialFromFirstAudioMs` and `finalTranscriptFromFirstAudioMs`
  (now computable post-bug-fix)
- Two-speaker conversation transcript to verify diarization labels
  beyond `0`
