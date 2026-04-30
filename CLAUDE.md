# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Accessibility-first real-time captioning prototype for **Even Realities G2 smart glasses**, packaged as an Even Hub WebView app (`com.antoniovargas.g2captions`, see `app.json`). The product floor is the built-in Conversate experience — superiority on latency, noisy WER, speaker labels, and custom vocabulary must be measured before claimed.

## Commands

```bash
npm test                       # Vitest suite (run mode, no watch)
npm run build                  # tsc --noEmit + vite build
npm run dev -- --port 5173     # Vite dev server, bound to 127.0.0.1
npm run prototype              # Node-only fixture prototype (tools/run-fixture-prototype.ts)
npm run benchmark:fixtures     # Multi-utterance fixture benchmark JSON
npm run hardware:readiness     # LAN QR/probe checklist for G2 smoke testing
npm run token-broker           # Local token broker on :8787 (needs ASSEMBLYAI_API_KEY and/or DEEPGRAM_API_KEY in env)
```

Run a single test: `npx vitest run tests/unit/formatter.test.ts` (or `-t "<name pattern>"`).

Vitest config lives in `vite.config.ts` (`environment: 'node'`). `tsconfig.json` has `noEmit: true` — `tsc` is type-check only; Vite emits the bundle.

Packaging the Even Hub plugin: `npm run build && evenhub pack app.json dist -o g2-captions.ehpk` (requires `@evenrealities/evenhub-cli` installed globally).

## Non-negotiable product rules

These come from `README.md` and `DECISIONS.md`. Treat as load-bearing — don't relax them without an explicit Tony approval gate:

- **Deaf-first UX**: no sound-only prompts, errors, or permission states. Every audio/network/ASR/provider failure surfaces visually on both the phone shell and the lens. `VisualStatusKind` in `src/types.ts` enumerates the failure categories that must remain visible.
- **API keys never in the WebView or in committed files**. Browser/WebView clients only ever see temporary streaming tokens fetched from the local broker; raw vendor keys live in `.env` (gitignored) and are read server-side by `tools/assemblyai-token-broker.ts`.
- **No live cloud audio, no vendor account creation, no payment, no new API keys without a separate Tony approval step** (`DECISIONS.md` D-0006 / G-0003). Defaulting to fixture-mode harnesses is the safe path.
- **BLE writes outside the official Even Hub SDK require a per-experiment safety gate** (D-0003). The SDK is the only sanctioned write path today.
- Don't add continuous-use, background, phone-lock, or "better than Conversate" claims until physical hardware benchmark evidence exists (`docs/10-live-audio-gates.md`, `docs/11-hardware-smoke.md`).

`DECISIONS.md` is the source of truth for architectural decisions. New decisions get a `D-NNNN` entry there with status and rationale; don't quietly change architecture in code without recording it.

## Architecture

The pipeline is intentionally split into separable interfaces (D-0001, D-0005) so audio capture, ASR, diarization, vocabulary, formatting, and display can each be swapped independently. Module-by-module:

- `src/audio/` — PCM sources. `pcmFixture.ts` (deterministic + real-speech fixtures), `browserMicrophone.ts` (opt-in), `g2SdkAudio.ts` (opt-in, requires Even Hub bridge). All emit 16 kHz mono PCM-S16LE chunks.
- `src/asr/` — Streaming ASR clients and live sessions. There are **two vendor seams**: AssemblyAI (`AssemblyAi*`, Universal-3 Pro `u3-rt-pro` over `wss://streaming.assemblyai.com/v3/ws`) and Deepgram (`Deepgram*`, currently the default wired into `src/app/main.ts`). `*TokenBroker.ts` files run server-side; `*StreamingClient.ts` and `*LiveSession.ts` run in the browser/Node and accept short-lived tokens. `FixtureAsrClient.ts` is the offline contract test seam — keep new providers conforming to its event shape (`RawAsrEvent` in `src/types.ts`).
- `src/captions/` — Caption state machine (`CaptionState.ts`), formatter (`formatter.ts` — produces a fixed-width text frame for the lens), latency telemetry (`latency.ts`), and visual error rendering (`visualErrors.ts`).
- `src/display/` — `g2LensDisplay.ts` writes through the official Even Hub SDK bridge; `phoneDisplay.ts` is the local/preview surface. Both must accept the same frame text from the formatter.
- `src/vocab/corrector.ts` — post-ASR vocabulary correction layer (used in addition to vendor keyterms when available).
- `src/benchmark/` — Multi-utterance fixture harness with WER-lite, vocabulary, and speaker-label scoring (`fixtureBenchmark.ts`).
- `src/hardware/readiness.ts` — Hardware smoke checklist generator.
- `src/app/main.ts` — WebView entry. Awaits `waitForEvenAppBridge()` from `@evenrealities/even_hub_sdk` (graceful fallback when running in a plain browser), wires buttons for fixture streaming and live sessions, and POSTs structured client logs back to the broker's `/client-log` endpoint.
- `src/app/runtimeConfig.ts` — Single source for broker URLs (token, streaming, log) and `?autoSmoke=0` query handling. The broker is always at the **same hostname as the page on port 8787** — this matters for G2 hardware smoke testing over LAN, where `localhost` won't resolve from the headset.

### Token broker (`tools/assemblyai-token-broker.ts`)

Despite the filename, this single broker handles **both** vendors. It exposes:

- `POST /assemblyai/token` and `POST /deepgram/token` — issues short-lived streaming tokens.
- WebSocket `/deepgram/listen` — proxies browser audio frames upstream so the API key stays server-side.
- `POST /client-log` — accepts structured client telemetry.

Origin allow-listing is enforced via `src/asr/AssemblyAiTokenBrokerServer.ts` (`isAllowedTokenBrokerOrigin`, `getTokenBrokerCorsOrigin`, `getTokenBrokerBindHost`). LAN host binding is required for G2 hardware smoke; the helpers handle that.

### Even Hub manifest (`app.json`)

The `permissions[].whitelist` is the network ACL enforced by Even Hub at runtime. When adding a new vendor or upstream, update both the manifest whitelist and `tests/integration/manifestPermissions.test.ts`.

## Conventions worth knowing

- **Strict TS**, ES2022, ESM-only (`"type": "module"`). No `tsc` emit — Vite builds the bundle. Vitest runs in `node` env.
- The dev server binds `127.0.0.1` by default; pass `--host` explicitly for LAN access during hardware smoke.
- Generated outputs (`dist/`, `*.ehpk`, `artifacts/`) are intentionally gitignored — don't commit them.
- Tests live in `tests/unit` and `tests/integration`. Integration tests for `manifestPermissions` and `accessibilityFallback` are guard rails for the non-negotiables above; if you change the manifest or visual-error pathway, update them.
- `docs/00-research.md` … `docs/11-*.md` are sequential, dated phase records. New phases get the next number; don't retroactively edit accepted ones.
