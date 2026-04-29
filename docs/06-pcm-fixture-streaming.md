# Phase 2 PCM Fixture Streaming

Date: 2026-04-29

## Scope completed

This step adds the first controlled audio-send path into the AssemblyAI WebSocket: a deterministic, paced, 16 kHz, 16-bit mono PCM fixture.

Important: the fixture is **silent PCM**. It is for transport/timing/safety smoke testing only. It is not a real speech benchmark and will not prove WER, diarization, or Conversate superiority.

## Implemented behavior

- Creates deterministic PCM S16LE mono fixtures.
- Chunks PCM into paced frames; default smoke path uses:
  - sample rate: `16000`
  - encoding: `pcm_s16le`
  - chunk size: `100ms`
- Sends each chunk as binary over the already-open AssemblyAI WebSocket.
- Waits for each chunk duration before sending the next chunk, matching AssemblyAI guidance that pre-recorded audio should be paced approximately in real time.
- Shows all audio-stream failures visually:
  - `AUDIO STREAM FAILED — ASR not connected`
  - `AUDIO FIXTURE STREAMING`
  - `AUDIO FIXTURE SENT — waiting ASR`
- Browser shell now exposes:
  - `Connect AssemblyAI`
  - `Stream Silent PCM Fixture`
  - `Terminate`

## Files changed

- `src/audio/pcmFixture.ts`
  - PCM fixture creator and chunker.
- `tests/unit/pcmFixture.test.ts`
  - fixture byte-length and chunk-duration tests.
- `src/asr/AssemblyAiLiveSession.ts`
  - `streamPcmChunks()` sends binary PCM frames and paces sends.
- `tests/unit/assemblyAiPcmStream.test.ts`
  - WebSocket binary send and visual failure tests.
- `src/app/main.ts`
  - browser smoke-test button for silent PCM fixture streaming.

## Verification

```text
npm test
Test Files  12 passed (12)
Tests       24 passed (24)
```

```text
npm run build
✓ built in 47ms
```

```text
evenhub pack app.json dist -o g2-captions.ehpk
Successfully packed g2-captions.ehpk (3805 bytes)
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

In browser / simulator:

1. Click `Connect AssemblyAI`.
2. Confirm visual state reaches `ASR CONNECTED — waiting audio`.
3. Click `Stream Silent PCM Fixture`.
4. Confirm visual states:

```text
AUDIO FIXTURE STREAMING
AUDIO FIXTURE SENT — waiting ASR
```

Expected result: the connection remains stable and AssemblyAI receives correctly paced PCM bytes. Because the fixture is silent, no useful transcript is expected.

## Next step

The next meaningful step is a **speech PCM fixture**, not live mic yet:

1. Generate or load a short known speech clip.
2. Convert it to `16kHz` mono `pcm_s16le`.
3. Pace it through the same `streamPcmChunks()` path.
4. Capture live AssemblyAI `Turn` events and measure:
   - first partial latency,
   - final-turn latency,
   - custom-vocabulary hit rate,
   - speaker-label behavior if two-speaker fixture is available.
