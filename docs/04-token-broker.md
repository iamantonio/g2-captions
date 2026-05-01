# Phase 2 Token Broker Setup

Date: 2026-04-29

## Credential handling

The AssemblyAI API key is intentionally **not written into this repo**.

Local secret files are ignored by `.gitignore`:

- `.env`
- `.env.*`

Use `.env.example` as a template only.

## Local run pattern

In a shell on Tony's machine, export the key locally, then start the broker:

```bash
export ASSEMBLYAI_API_KEY="<local AssemblyAI key>"
export ASSEMBLYAI_TOKEN_BROKER_PORT=8787
npm run token-broker
```

The broker listens on:

```text
http://127.0.0.1:8787/assemblyai/token
```

It accepts:

```text
POST /assemblyai/token
```

And returns only:

```json
{
  "token": "temporary-streaming-token",
  "expiresInSeconds": 60
}
```

The raw AssemblyAI API key is never returned to the browser/WebView.

## Implemented files

- `.gitignore` — ignores local env files and generated artifacts.
- `.env.example` — placeholder-only local config template.
- `src/asr/AssemblyAiTokenBroker.ts` — tested temporary token request helper.
- `tools/token-broker.ts` — local HTTP broker for dev/prototype token generation.
- `tests/unit/assemblyAiTokenBroker.test.ts` — token broker tests.
- `package.json` — added `npm run token-broker`.

## Verification

```text
npm test
Test Files  9 passed (9)
Tests       17 passed (17)
```

```text
npm run build
✓ built in 38ms
```

```text
evenhub pack app.json dist -o g2-captions.ehpk
Successfully packed g2-captions.ehpk (1261 bytes)
```

## Not done yet

This step does **not** start live microphone capture and does **not** stream audio. It only creates the safe token-broker seam needed before live ASR.

Next implementation step: phone/WebView client fetches `POST /assemblyai/token`, receives a temporary token, opens AssemblyAI WebSocket with the existing URL builder, and displays all connection/token failures visually.
