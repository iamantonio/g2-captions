# Expanded provider fixture comparison — Deepgram vs OpenAI vs ElevenLabs

Date: 2026-05-07

## Safety boundary

This run stayed fixture-only:

- No browser microphone capture.
- No G2 SDK audio capture.
- No BLE writes.
- No background/always-on capture.
- No production claims versus Conversate or real G2 noisy conversation performance.

All new audio fixtures are generated locally with macOS `say` and converted to 16 kHz mono PCM-S16LE. They are not live recordings and are not public/audio-dataset evidence.

## Fixture set

| Fixture                    | Type                                       | Expected transcript                                |
| -------------------------- | ------------------------------------------ | -------------------------------------------------- |
| `speech-smoke.pcm`         | existing clean generated smoke             | `Proven machine captions are ready.`               |
| `custom-vocab-g2.pcm`      | generated custom vocabulary phrase         | `ProvenMachine captions are ready on G2.`          |
| `noisy-meeting-code.pcm`   | generated TTS + low-level pink-noise proxy | `Please repeat the meeting code slowly.`           |
| `two-speaker-captions.pcm` | generated two-voice proxy with pause       | `Can you see captions? Yes, captions are visible.` |

Generated/added alongside `.txt` manifests:

```text
public/fixtures/custom-vocab-g2.pcm
public/fixtures/custom-vocab-g2.txt
public/fixtures/noisy-meeting-code.pcm
public/fixtures/noisy-meeting-code.txt
public/fixtures/two-speaker-captions.pcm
public/fixtures/two-speaker-captions.txt
```

Command:

```bash
npm run benchmark:providers
```

Output artifact:

```text
artifacts/provider-fixture-comparison.json
```

## Aggregate result

Initial 4-fixture run exposed an OpenAI harness bug: `tools/run-openai-realtime-smoke.ts` closed the socket on the first `conversation.item.input_audio_transcription.completed` event even though fixture streaming was still in progress. That made the two-speaker fixture look like an OpenAI model miss. The harness now keeps the socket open until fixture streaming is complete and either a post-stream final arrives or the post-stream wait expires.

Corrected 4-fixture run:

| Provider   | Model                  | Exact-match rate | Mean WER-lite | Mean first partial | Mean final transcript |
| ---------- | ---------------------- | ---------------: | ------------: | -----------------: | --------------------: |
| Deepgram   | `nova-3`               |           `0.75` |      `0.1667` |         `988.5 ms` |           `2572.5 ms` |
| ElevenLabs | `scribe_v2_realtime`   |           `0.75` |         `0.1` |        `2115.5 ms` |             `2563 ms` |
| OpenAI     | `gpt-realtime-whisper` |           `0.75` |      `0.0833` |           `995 ms` |           `2553.5 ms` |

## Per-fixture result highlights

### Clean smoke

- Deepgram: exact, speaker labels present.
- OpenAI: exact, no speaker labels.
- ElevenLabs: returned `ProvenMachine captions are ready.`; mismatch against expected plain `Proven machine` wording.

### Custom vocabulary / G2

- ElevenLabs: exact on `ProvenMachine captions are ready on G2.`
- Deepgram/OpenAI: both returned `Proven machine captions are ready on G2.`; semantically fine but exact mismatch against the custom vocabulary token expectation.
- Speaker labels only appeared in Deepgram output.

### Noisy meeting-code proxy

- All three providers returned the expected transcript exactly.
- Deepgram kept speaker labels.
- ElevenLabs still did not emit first partial latency in this harness.

### Two-speaker proxy

- Deepgram normalized to `Can you see captions? Yes. Captions are visible.`; WER-lite `0` after punctuation normalization and speaker labels present.
- ElevenLabs returned exact expected text, no speaker labels.
- OpenAI now returns exact expected text when the smoke harness waits beyond the first completed event: `Can you see captions? Yes, captions are visible.` No speaker labels.

## Readout

This expanded fixture run makes the tradeoff clearer:

- Deepgram remains the safest default because it combines low WER, useful latency, and speaker-label visibility.
- OpenAI’s new realtime transcription is viable across these controlled generated fixtures after fixing the smoke harness to wait beyond the first completed event, but it still lacks observed speaker labels and still misses the exact `ProvenMachine` custom token.
- ElevenLabs is competitive on final timing and custom vocabulary formatting, but speaker labels and first-partial behavior remain weaker for our app goals.

This is still not live-hardware evidence. It is enough to guide the next fixture/debug phase before asking for live browser-mic or G2 SDK audio approval.

## Tooling changes in this step

- `tools/run-provider-fixture-comparison.ts` now runs all 4 fixtures across all 3 providers.
- `src/benchmark/providerComparison.ts` now includes:
  - `fixtures[]` coverage summary,
  - `aggregate.fixtureCount`,
  - `aggregate.resultCount`,
  - per-provider exact-match/WER/latency aggregates.
- `tests/unit/providerComparison.test.ts` covers the multi-fixture aggregate behavior.

## Verification

```bash
npx vitest run tests/unit/providerComparison.test.ts
npm run build
npm run benchmark:providers
```

All passed in the 2026-05-07 run.

## Browser app two-speaker OpenAI fixture re-smoke

After the CLI harness fix, the browser app path was re-smoked fixture-only with:

```text
http://127.0.0.1:5173/?asr=openai&debug=1&autoSmoke=0&fixture=two-speaker-captions.pcm
```

Implementation note: `getSpeechFixtureUrl()` now accepts a filename-only `?fixture=...` override for bundled `.pcm` fixtures and rejects full/remote URLs back to `speech-smoke.pcm`, so debug fixture selection does not become arbitrary remote audio loading.

Observed browser telemetry included both OpenAI completed transcript events:

```text
Can you see captions?
Yes, captions are visible.
```

Final visible caption frame showed the second finalized utterance (`Yes, captions are visible.`) with `SMOKE OK`; telemetry JSON preserved both final transcript events. Browser console had no JavaScript errors. Plain-browser Even Hub bridge failure statuses are expected in local preview.

## Next gate

Recommended next safe step: optional README/operator documentation for OpenAI fixture testing, then ask Antonio before any browser microphone cloud-audio test.

Do not proceed to live browser-mic, G2 SDK audio, or G2 hardware smoke without explicit approval.
