# OpenAI latency tuning matrix

Date: 2026-05-08

## Purpose

OpenAI realtime transcription preserved the controlled G2 vocabulary better than Deepgram in the first strict hardware benchmark, but it was materially slower:

- Deepgram first partial: `1,987 ms`
- OpenAI first partial: `4,049 ms`
- Deepgram first final: `4,730 ms`
- OpenAI first final: `6,994 ms`

This phase adds safe URL-level tuning for OpenAI live-audio commit cadence so hardware runs can test whether earlier `input_audio_buffer.commit` calls reduce latency without harming accuracy.

## Safety boundary

- OpenAI remains explicit only via `?asr=openai`.
- API keys remain server-side in the local broker.
- This is manual foreground G2 SDK audio only; no background or always-on capture.
- Deepgram remains the default/product provider until OpenAI closes latency and speaker-label gaps.

## New query params

```text
openaiCommitMs=<milliseconds>
openaiFinalWaitMs=<milliseconds>
```

### `openaiCommitMs`

Controls periodic live-audio commits inside `OpenAiLiveSession.sendPcmChunk()`.

```text
unset or 0 -> preserve existing behavior; no periodic live commits
500        -> commit after about 500 ms of G2 PCM chunks
1000       -> commit after about 1 second
1500       -> commit after about 1.5 seconds
```

Bounds:

```text
min: 500 ms
max: 5000 ms
```

Each live commit emits telemetry:

```text
provider_commit_sent { seq }
```

### `openaiFinalWaitMs`

Controls fixture/open-buffer final-wait timeout after a final explicit commit.

Default:

```text
4000 ms
```

Bounds:

```text
min: 1000 ms
max: 10000 ms
```

## Hardware tuning matrix URLs

Use the active default-route LAN IP, not a hardcoded interface.

Example using the last successful IP:

```text
http://192.168.1.205:5173/?asr=openai&autoSmoke=0&debug=1&mode=hardwareBenchmark&openaiCommitMs=0
http://192.168.1.205:5173/?asr=openai&autoSmoke=0&debug=1&mode=hardwareBenchmark&openaiCommitMs=500
http://192.168.1.205:5173/?asr=openai&autoSmoke=0&debug=1&mode=hardwareBenchmark&openaiCommitMs=1000
http://192.168.1.205:5173/?asr=openai&autoSmoke=0&debug=1&mode=hardwareBenchmark&openaiCommitMs=1500
```

Read the same strict benchmark script each run:

```text
1. OpenAI G2 summary telemetry test.
2. Proven Machine captions are live on the glasses.
3. I want accurate captions in noisy rooms.
4. The client asked about website conversion and SEO.
```

After Stop Live Audio, compare `/client-logs` `g2_sdk_audio_smoke_summary`:

- `metrics.firstPartialFromFirstAudioMs`
- `metrics.finalTranscriptFromFirstAudioMs`
- `benchmark.exactMatchRate`
- `benchmark.meanWordErrorRateLite`
- `finalTranscripts`
- count/timing of `provider_commit_sent`

## Implementation notes

Changed files:

- `src/app/runtimeConfig.ts` — parses `getOpenAiRealtimeOptions()`.
- `src/app/main.ts` — passes parsed OpenAI tuning into `OpenAiLiveSession`.
- `src/asr/OpenAiLiveSession.ts` — optional periodic live commits by accumulated PCM duration.
- `src/captions/latency.ts` — added `provider_commit_sent` telemetry stage.
- `tests/unit/runtimeConfig.test.ts` — URL parsing coverage.
- `tests/unit/openAiLiveSession.test.ts` — periodic commit coverage.

Verification:

```bash
npx vitest run tests/unit/runtimeConfig.test.ts tests/unit/openAiLiveSession.test.ts tests/unit/openAiRealtimeClient.test.ts tests/unit/AudioController.test.ts tests/unit/hardwareBenchmark.test.ts
npm run build
```

Result: 5 test files / 46 tests passed; production build passed.

## Real G2 hardware matrix result

The OpenAI matrix was run on real G2 SDK audio with the strict four-phrase benchmark script.

| `openaiCommitMs` | Audio ms | Final count | Exact match | WER-lite | First partial | First final | Result                         |
| ---------------: | -------: | ----------: | ----------: | -------: | ------------: | ----------: | ------------------------------ |
|              `0` |   21,600 |           4 |        1.00 |     0.00 |      2,203 ms |    4,922 ms | winner                         |
|            `500` |   20,200 |          17 |        0.00 |     1.00 |      1,747 ms |    1,998 ms | rejected: severe fragmentation |
|           `1000` |   19,200 |          14 |        0.00 |     1.00 |      1,210 ms |    1,582 ms | rejected: severe fragmentation |
|           `1500` |   20,500 |           5 |        0.50 |    0.321 |      2,448 ms |    5,330 ms | rejected: phrase split         |

Conclusion:

```text
Periodic OpenAI live commits are not viable for phrase-level G2 captions yet.
```

They reduce first-final latency but force premature `input_audio_buffer.commit` boundaries, causing fragmented final transcripts and broken benchmark scoring. Keep the default:

```text
openaiCommitMs=0
```

Next OpenAI tuning should investigate non-fragmenting alternatives, not periodic manual commits:

1. OpenAI session/server-side transcription options, if supported by the current API.
2. Client-side partial display behavior without committing buffers.
3. Phrase aggregation/repair after fragmented finals, only if it does not delay display too much.
4. Noise/multi-speaker testing with `openaiCommitMs=0` before any default/product decision.
