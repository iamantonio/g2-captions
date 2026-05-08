# OpenAI realtime audio announcement review for G2 Captions

Date: 2026-05-07  
Source video: https://www.youtube.com/watch?v=JOu8v6CBjkE  
Related docs checked:

- https://developers.openai.com/api/docs/models/gpt-realtime-2
- https://developers.openai.com/api/docs/models/gpt-realtime-translate
- https://developers.openai.com/api/docs/models/gpt-realtime-whisper
- https://developers.openai.com/api/docs/guides/realtime-transcription
- https://developers.openai.com/api/docs/guides/realtime-translation
- https://developers.openai.com/api/docs/guides/realtime-websocket

## What the video announced

OpenAI introduced new realtime audio models in the API:

1. `gpt-realtime-translate` — a live translation model.
   - Demo showed French speech translated into English while the speaker continued talking.
   - The presenter emphasized that it waits for sentence-shaping words, such as verbs, before translating, which can make output feel less word-by-word and more natural.
   - The demo included quick language switching between French and German.
   - The presenter claimed support across 70 languages.

2. `gpt-realtime-2` — a reasoning voice-agent model.
   - Demo showed a personal assistant checking a calendar, staying quiet while still listening, then updating a CRM.
   - Key behaviors highlighted: reasoning, parallel tool calling, preambles/status updates while actions run, staying in conversation without interrupting until a wake phrase.

## Relevance to G2 Captions

The most relevant model for the current captioning app is **not** `gpt-realtime-2` first. For a deaf-first live captioner, the initial OpenAI tests should target:

1. `gpt-realtime-whisper` for live transcription/captions.
   - Docs describe it as a streaming speech-to-text model for realtime transcript deltas.
   - Realtime transcription sessions are specifically for live captions/live STT with no spoken assistant response.
   - Pricing observed in model docs: `$0.017` per minute of realtime audio.

2. `gpt-realtime-translate` for multilingual captions / interpreter mode.
   - Docs describe it as streaming source audio to receive translated audio plus transcript deltas.
   - For G2, we should ignore/disable audio output and render translated transcript deltas on the lens.
   - Pricing observed in model docs: `$0.034` per minute of realtime audio.

3. `gpt-realtime-2` only for a later voice-agent / connected-assistant mode.
   - It is compelling for preambles, tool calls, and connected systems, but that is a different product surface than deaf-first captioning.
   - It may matter later if G2 Captions grows into “caption + action assistant,” but it should not replace the caption provider benchmark.

## Important API shape differences

### Realtime transcription

Docs show a transcription session with:

- Session type: `transcription`
- Input audio append event: `input_audio_buffer.append`
- Audio payload: base64 PCM16
- Recommended PCM format in docs example: `audio/pcm` at `24000` Hz
- Transcript events:
  - `conversation.item.input_audio_transcription.delta`
  - `conversation.item.input_audio_transcription.completed`

This differs from the current app’s Deepgram proxy, which sends raw binary 16 kHz PCM frames and receives `Results` events.

### Realtime translation

Docs show a dedicated endpoint for translation:

- Browser/WebRTC path creates a short-lived client secret server-side.
- WebSocket path is recommended when a server already receives raw audio.
- WebSocket audio input is base64-encoded `24 kHz` PCM16.
- Event stream can include translated transcript deltas and optionally source transcript deltas.

This differs from current app architecture in two ways:

1. The G2 SDK currently emits `16 kHz` mono PCM. OpenAI realtime docs expect `24 kHz` PCM for these websocket examples, so we need a resampling step or WebRTC path.
2. OpenAI WebSocket payloads are JSON messages with base64 audio, not raw binary PCM.

## Fit against current G2 Captions architecture

Current app state from repo inspection:

- Runtime provider selector currently supports `deepgram` and `elevenlabs` in `src/app/runtimeConfig.ts`.
- Deepgram is default and uses `/deepgram/listen` on our broker as a WebSocket proxy.
- Existing provider seams already include:
  - `connect()`
  - `streamPcmChunks(chunks)`
  - `sendPcmChunk(chunk)`
  - `terminate(status)`
  - `onTranscript(RawAsrEvent)`
  - visual-only status and telemetry callbacks
- The broker already centralizes vendor API keys, rate limiting, CORS/origin handling, bearer auth, and client logs.

So the right approach is a **third provider adapter**, not a product rewrite.

## Proposed OpenAI test plan

### Phase A — docs + decision gate

- Add a decision entry before implementation: OpenAI is an experimental provider candidate, not a replacement for Deepgram yet.
- Preserve D-0006: no new API key, payment, or live cloud audio without Antonio approval.
- Add `OPENAI_API_KEY` only to `.env.example`; never expose it in WebView code or committed files.

### Phase B — fixture-only OpenAI adapter contract

Build pure/testable modules first:

- `src/asr/OpenAiRealtimeClient.ts`
  - builds websocket/session URLs
  - builds `session.update`
  - builds `input_audio_buffer.append`
  - maps transcription delta/completed events to `RawAsrEvent`
- `src/asr/OpenAiLiveSession.ts`
  - mirrors Deepgram/ElevenLabs live session shape
  - accepts 16 kHz `PcmChunk` from current app, resamples to 24 kHz before base64 JSON send, or defers resampling to a server-side proxy
- `tests/unit/openAiRealtimeClient.test.ts`
- `tests/unit/openAiLiveSession.test.ts`

No actual OpenAI network calls in unit tests.

### Phase C — local smoke through broker

Add broker support as server-side proxy first:

- HTTP health/config route for OpenAI availability, or direct route like `/openai/realtime-token` if using ephemeral browser auth.
- WebSocket proxy route like `/openai/transcribe` so the browser never receives the raw OpenAI API key.
- Broker upstream connects to `wss://api.openai.com/v1/realtime?intent=transcription` or the current documented transcription websocket equivalent.
- Browser sends app-native PCM chunks to broker; broker handles resampling + base64 JSON if we choose server-side resampling.

This keeps the existing packaged WebView security model intact.

### Phase D — fixture benchmark

Run the same benchmark harness used for Deepgram/ElevenLabs:

- first partial latency
- final transcript latency
- WER-lite
- custom vocabulary hit rate for `ProvenMachine` and `Even Realities G2`
- speaker-label availability (expected weak/unknown for realtime transcription unless docs/API expose diarization in realtime)
- stability: duplicate/rewritten partials per minute

### Phase E — hardware smoke only after local fixture passes

Only after fixture smoke passes:

- Start with `?autoSmoke=1` fixture over the broker, not live mic.
- Then browser mic.
- Then G2 SDK audio.
- Do not claim “better than Conversate” or “better than Deepgram” until real G2 noisy-conversation data exists.

## Specific risks / questions

1. **Diarization:** `gpt-realtime-whisper` docs reviewed do not establish realtime diarization. Current G2 product needs speaker chips. If OpenAI realtime lacks speaker labels, it may be useful for latency/accuracy/translation, but not a full Deepgram replacement.
2. **Sample rate mismatch:** G2 audio is 16 kHz PCM; OpenAI examples use 24 kHz PCM. We need a verified resampler path.
3. **Payload format mismatch:** current providers send binary frames; OpenAI realtime websocket examples use JSON + base64 audio events.
4. **Cost / billing:** OpenAI realtime transcription appears duration-priced. We need hard stop/terminate behavior and broker caps before hardware tests.
5. **Manifest:** packaged Even Hub builds will need `https://api.openai.com` / `wss://api.openai.com` only if the WebView connects directly. If we use our broker proxy, `app.json` should only need the broker origin.
6. **Translation mode value:** strong product opportunity for “caption what they said in English” when another person speaks another language. But default app mode should remain same-language captions.

## Recommendation

Proceed with an **OpenAI experimental provider spike** behind `?asr=openai`, starting with `gpt-realtime-whisper` realtime transcription. Treat `gpt-realtime-translate` as a second spike for multilingual captions. Do not pivot the product to `gpt-realtime-2` yet; it is a voice-agent model and useful later for connected-assistant workflows, not the core caption provider benchmark.

The first code milestone should be unit-tested event mapping + session message construction, then a broker-proxied fixture smoke. No live G2 audio until Antonio explicitly approves using an OpenAI API key and billable live cloud audio.

## 2026-05-07 implementation + local fixture smoke result

Implemented the experimental OpenAI provider path behind `?asr=openai`:

- `src/asr/OpenAiRealtimeClient.ts`
  - Builds transcription `session.update` for `gpt-realtime-whisper`.
  - Resamples app-native 16 kHz PCM16 mono chunks to 24 kHz PCM16.
  - Sends OpenAI JSON/base64 `input_audio_buffer.append` frames.
  - Maps `conversation.item.input_audio_transcription.delta` and `.completed` into `RawAsrEvent`.
- `src/asr/OpenAiLiveSession.ts`
  - Mirrors the existing provider lifecycle: `connect`, `streamPcmChunks`, `sendPcmChunk`, `terminate`.
  - Keeps visual status and telemetry callbacks.
- Broker route `/openai/transcribe`
  - Browser/WebView connects only to the local/deployed broker.
  - Broker attaches `Authorization: Bearer ${OPENAI_API_KEY}` upstream.
  - Client query params such as `api_key=...` are ignored and not forwarded.
- Runtime selection:
  - Deepgram remains default.
  - OpenAI is explicit only via `?asr=openai`.

Smoke harness added:

```bash
npm run smoke:openai
```

Local broker fixture smoke result using `public/fixtures/speech-smoke.pcm`:

- Provider/model: `openai` / `gpt-realtime-whisper`
- Route: `ws://127.0.0.1:8787/openai/transcribe`
- Fixture chunks: 20 x 100 ms
- First partial from first audio: `832 ms`
- Final from first audio: `2554 ms`
- Final transcript: `Proven machine captions are ready.`

Observed API correction:

- `turn_detection` is not supported for `gpt-realtime-whisper` transcription sessions. Initial smoke failed with: `Turn detection is not supported for this transcription model.`
- Fix: omit `turn_detection` from the OpenAI transcription `session.update`; manually send `input_audio_buffer.commit` after fixture streaming.

Verification after fix:

- `npx vitest run tests/unit/openAiRealtimeClient.test.ts tests/unit/openAiLiveSession.test.ts` passed.
- Broker-proxied fixture smoke passed.

## 2026-05-07 browser app fixture smoke result

Local browser path tested with:

```bash
set -a; source .env; set +a; npm run token-broker
npm run dev -- --port 5173 --host 127.0.0.1
# browser: http://127.0.0.1:5173/?asr=openai&debug=1&autoSmoke=0
# click: Stream Speech PCM Fixture
```

First browser smoke surfaced a real app-path issue: `streamSpeechFixture()` terminated the OpenAI session immediately after sending fixture chunks, before the OpenAI `.completed` event arrived. Result: only partial deltas rendered before `SMOKE OK`.

Fix:

- `OpenAiLiveSession.streamPcmChunks()` now sends `input_audio_buffer.commit` after fixture chunks and waits for `conversation.item.input_audio_transcription.completed` before resolving, with a timeout fallback.
- Added unit coverage that verifies fixture streaming sends append + commit and does not resolve until the final transcript arrives.

Verified browser result after fix:

- URL: `/?asr=openai&debug=1&autoSmoke=0`
- Fixture: `speech-smoke.pcm`
- Final transcript rendered in UI: `Proven machine captions are ready.`
- Telemetry:
  - First partial from first audio: `1216 ms`
  - Final transcript from first audio: `2782 ms`
  - Display update from final transcript: `1 ms`
- Browser console: no JavaScript exceptions. Plain-browser preview still logs expected Even Hub bridge/display fallback noise because no real Flutter/Hub bridge is present.

Verification command after browser-path fix:

```bash
npx vitest run tests/unit/openAiLiveSession.test.ts tests/unit/openAiRealtimeClient.test.ts tests/unit/runtimeConfig.test.ts tests/integration/tokenBroker.test.ts && npm run build
```

Result: 4 test files / 44 tests passed, then `tsc && vite build` passed.
