# Phase 2.2 — Multi-Utterance Fixture Benchmark

Status: implemented as a fixture-only benchmark harness.

## Scope

This phase adds a small benchmark suite for comparing transcript quality and timing before any live audio source is allowed into the app.

The benchmark deliberately uses controlled fixtures only:

- no browser microphone capture
- no G2 SDK audio capture
- no BLE writes
- no always-on/background capture

## Fixture set

| Fixture | Source | Purpose | License / dataset note |
| --- | --- | --- | --- |
| `clean-short-generated` | `public/fixtures/speech-smoke.pcm` | Clean short speech smoke path | Generated locally for this project; no external dataset license. |
| `custom-vocab-generated` | scripted synthetic transcript | Exercises `ProvenMachine` and `G2` vocabulary correction | Synthetic/local only; audio can be generated later. |
| `noisy-speech-scripted` | scripted synthetic transcript | Placeholder for noisy-condition scoring until an approved sample is selected | No external audio included. |
| `two-speaker-scripted` | scripted synthetic transcript | Placeholder for speaker-label scoring until an approved sample is selected | No external audio included. |

The noisy and two-speaker fixtures are intentionally marked `scripted-only`; they should not be represented as measured public-audio results until a properly licensed public sample is chosen and documented.

## Metrics

Each fixture report includes:

- `firstPartialLatencyMs`
- `finalTranscriptLatencyMs`
- `exactMatch`
- `wordErrorRateLite`
- `customVocabularyHitRate`
- `speakerLabelHitRate`
- visible `notes` for transcript, vocabulary, or speaker-label misses

Aggregate report includes:

- fixture count
- exact match rate
- mean WER-lite
- custom vocabulary hit rate
- speaker label hit rate

## Command

```bash
npm run benchmark:fixtures
```

Default output:

```text
artifacts/phase-2.2-fixture-benchmark.json
```

`artifacts/` is ignored so benchmark outputs can be regenerated without committing local artifacts.

## Latest local run

Command:

```bash
npm test -- tests/unit/fixtureBenchmark.test.ts && npm run benchmark:fixtures
```

Result:

```json
{
  "suiteId": "phase-2.2-fixtures",
  "fixtureCount": 4,
  "exactMatchRate": 1,
  "customVocabularyHitRate": 1,
  "speakerLabelHitRate": 1,
  "audioSource": "fixture-only",
  "safety": {
    "noBrowserMic": true,
    "noG2SdkAudio": true,
    "noBleWrites": true,
    "noBackgroundCapture": true
  }
}
```

Interpretation: the benchmark harness, vocabulary correction, scripted transcript scoring, and report generation work. This is not a Conversate superiority claim and is not yet a live ASR/hardware benchmark.

## Next gate

The next possible phase is browser microphone exploration, but it should remain behind explicit approval and should use this benchmark report as the baseline comparison target.
