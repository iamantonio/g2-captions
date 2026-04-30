# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Apache 2.0 license.
- `DEEPGRAM_API_KEY` placeholder in `.env.example`.
- `npm run clean` script for build artifacts.
- Dependabot config for weekly npm + GitHub Actions updates.
- Three-phase audit + research + fix-plan documents at the repo root
  (`AUDIT.md`, `RESEARCH.md`, `FIX_PLAN.md`).
- Phase 1 doc record `docs/12-manifest-whitelist-spike.md` for the
  Even Hub manifest whitelist scope question (S-7).

### Changed

- D-0007 in `DECISIONS.md` documents the Even Hub SDK pinning policy.

## [0.1.0] - 2026-04-29

### Added

- Phase 2 prototype scaffold: Vite + TypeScript + Vitest.
- Even Hub manifest for G2 Captions (`com.antoniovargas.g2captions`).
- Fixture ASR client and caption formatter.
- AssemblyAI Universal-Streaming `u3-rt-pro` URL/client seam and live
  session wiring; local AssemblyAI temporary-token broker.
- Deepgram Nova-3 streaming wired as the default vendor seam, with
  Deepgram token broker and WebSocket proxy.
- Deterministic silent-PCM and real-speech-PCM fixture streaming paths.
- Structured latency telemetry and visible telemetry JSON.
- Multi-utterance fixture benchmark harness with WER-lite, vocabulary,
  and speaker-label scoring.
- Opt-in browser microphone and G2 SDK audio prototype paths.
- Lens-style text rendering helper and visual-only status/error states.
- Test/build/packaging smoke path; CI workflow on Node 22.
