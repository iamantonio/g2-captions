# Phase 2 Live ASR Gate — AssemblyAI Scaffold

Date: 2026-04-29

## Scope completed

Tony approved the first live ASR benchmark gate after the fixture prototype. This step keeps credentials out of the WebView and commits only the provider seam, URL/token guardrails, event mapper, manifest permission, and tests.

## Vendor/auth choice

- First provider: AssemblyAI, matching the approved benchmark order in `DECISIONS.md`.
- Browser/WebView auth: temporary streaming token only.
- API keys: not embedded, not committed, not stored in this repo.
- Network permission: `https://streaming.assemblyai.com` added to `app.json` for the approved benchmark.

## Cited vendor facts

- AssemblyAI Universal-Streaming uses WebSocket endpoint `wss://streaming.assemblyai.com/v3/ws` and supports temporary-token auth through the `token` query parameter: https://assemblyai.com/docs/api-reference/streaming-api/universal-streaming/universal-streaming
- Temporary tokens are generated server-side from `/v3/token`, are one-time-use, and `expires_in_seconds` must be between 1 and 600 seconds: https://assemblyai.com/docs/streaming/authenticate-with-a-temporary-token
- Universal-3 Pro Streaming uses model identifier `u3-rt-pro`; sessions are billed by WebSocket session duration and should be terminated explicitly: https://assemblyai.com/docs/streaming/universal-3-pro

## Files changed

- `DECISIONS.md` — recorded approval and cited AssemblyAI facts.
- `app.json` — added approved AssemblyAI network permission.
- `src/asr/AssemblyAiStreamingClient.ts` — added:
  - temporary-token validation,
  - streaming WebSocket URL builder,
  - AssemblyAI Turn-event mapper into the shared `RawAsrEvent` contract,
  - terminate-message builder.
- `tests/unit/assemblyAiClient.test.ts` — TDD coverage for URL/auth guardrails and event mapping.
- `tests/integration/manifestPermissions.test.ts` — TDD coverage for the exact network whitelist.

## Verification

```text
npm test
Test Files  8 passed (8)
Tests       14 passed (14)
```

```text
npm run build
✓ built in 38ms
```

```text
evenhub pack app.json dist -o g2-captions.ehpk
Successfully packed g2-captions.ehpk (1261 bytes)
PACKED:/Users/tony/Dev/EvenApps/g2-captions/g2-captions.ehpk
```

## Still not done / next safety gates

This is not live microphone capture yet. Remaining gates before daily-driver testing:

1. Token broker endpoint: generate temporary AssemblyAI tokens without exposing API keys to the WebView.
2. Audio source plumbing: stream 16 kHz PCM chunks from an approved source into the provider seam.
3. Cost/privacy controls: visible session timer, explicit terminate behavior, and visual-only network/provider errors.
4. Accuracy/latency benchmark: measured against noisy data before any claim that this beats Conversate.
