# Provider fixture comparison — Deepgram vs OpenAI vs ElevenLabs

Date: 2026-05-07

## Safety boundary

This run stayed fixture-only:

- No browser microphone capture.
- No G2 SDK audio capture.
- No BLE writes.
- No background/always-on capture.
- No product claim that any provider is better than Conversate or better for real G2 noisy conversation use.

Fixture used for all providers:

- `public/fixtures/speech-smoke.pcm`
- Expected transcript: `Proven machine captions are ready.`

Command:

```bash
npm run benchmark:providers
```

Output artifact:

```text
artifacts/provider-fixture-comparison.json
```

## Result summary

| Provider   | Model                  |                     Final transcript | Exact match | WER-lite | First partial | Final transcript | Speaker labels | Notes                                                                                  |
| ---------- | ---------------------- | -----------------------------------: | ----------: | -------: | ------------: | ---------------: | -------------: | -------------------------------------------------------------------------------------- |
| Deepgram   | `nova-3`               | `Proven machine captions are ready.` |         yes |      `0` |      `985 ms` |        `2091 ms` |            yes | —                                                                                      |
| OpenAI     | `gpt-realtime-whisper` | `Proven machine captions are ready.` |         yes |      `0` |     `1758 ms` |        `2562 ms` |             no | no speaker labels observed                                                             |
| ElevenLabs | `scribe_v2_realtime`   |  `ProvenMachine captions are ready.` |          no |    `0.4` |       missing |        `2022 ms` |             no | exact mismatch due `ProvenMachine` tokenization; no speaker labels; no partial latency |

## Readout

On this one clean fixture:

- Deepgram and OpenAI both got the transcript exactly right.
- Deepgram produced first partial faster than OpenAI in this run.
- ElevenLabs committed slightly faster than Deepgram/OpenAI, but it normalized `Proven machine` into `ProvenMachine`, which is a mismatch against this fixture’s expected plain phrase.
- OpenAI did not provide speaker labels in this path; that remains a core limitation for replacing Deepgram in a conversation-captioning product.
- This is still too small and clean to make product claims. It is a transport/provider sanity baseline only.

## New reusable tooling

Added:

- `src/benchmark/providerComparison.ts`
  - Scores provider smoke results with exact match, WER-lite, latency rankings, and speaker-label visibility.
- `tests/unit/providerComparison.test.ts`
  - Verifies fixture-only safety flags, scoring, notes, and rankings.
- `tools/run-deepgram-smoke.ts`
  - Adds a broker-proxied Deepgram fixture smoke harness matching OpenAI/ElevenLabs smoke output shape.
- `tools/run-provider-fixture-comparison.ts`
  - Runs Deepgram, OpenAI, and ElevenLabs fixture smokes and writes `artifacts/provider-fixture-comparison.json`.
- Package scripts:
  - `npm run smoke:deepgram`
  - `npm run benchmark:providers`

## Verification

```bash
npx vitest run tests/unit/providerComparison.test.ts
npm run build
npm run benchmark:providers
```

All passed in the 2026-05-07 run.

## Next gate

Recommended next step is not live audio yet. The next safe improvement is to expand fixture coverage with 2–3 more approved/generated PCM files:

1. custom vocabulary phrase,
2. noisy room proxy,
3. two-speaker proxy if we can create/approve a safe fixture.

Only after fixture coverage is broader should we ask Antonio for a live browser-mic or G2 SDK audio approval gate.
