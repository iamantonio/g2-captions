# OpenAI hard-condition G2 smoke

Date: 2026-05-08

## Purpose

OpenAI with `openaiCommitMs=0` had the best controlled benchmark result so far: 4/4 exact phrase matches and WER-lite `0`. This phase tests whether that accuracy survives harder real-world conditions on real Even Realities G2 SDK audio.

## Safety boundary

- OpenAI remains explicit only via `?asr=openai`.
- `openaiCommitMs=0` was used because periodic commits fragmented final transcripts.
- API keys remained server-side in the local token broker.
- Manual foreground G2 SDK audio only; no background or always-on capture.
- Deepgram remains default/product until OpenAI proves latency, noise robustness, multi-speaker behavior, and speaker-label needs.

## URL

```text
http://192.168.1.205:5173/?asr=openai&autoSmoke=0&debug=1&mode=hardwareBenchmark&openaiCommitMs=0
```

## Fixed phrase script

For the first three conditions, the normal strict hardware benchmark script was used:

1. OpenAI G2 summary telemetry test.
2. Proven Machine captions are live on the glasses.
3. I want accurate captions in noisy rooms.
4. The client asked about website conversion and SEO.

For the service-vocabulary condition, a separate vocabulary script was read:

```text
HVAC water mitigation conversion rate Google Business Profile Even Realities G2 Proven Machine.
```

Because that script is different from the fixed on-screen benchmark phrases, its benchmark exact/WER score is intentionally not comparable; judge it by the captured final transcript.

## Results

| Condition                   | Audio ms | Finals | Exact match | WER-lite | First partial | First final | Interpretation                                         |
| --------------------------- | -------: | -----: | ----------: | -------: | ------------: | ----------: | ------------------------------------------------------ |
| Fan / room noise            |   21,200 |      4 |        1.00 |     0.00 |      2,052 ms |    4,957 ms | Pass                                                   |
| TV/music background         |   20,400 |      4 |        0.00 |     0.65 |      1,886 ms |    8,601 ms | Fail                                                   |
| Second speaker/interruption |   19,900 |      3 |        0.50 |    0.857 |      2,132 ms |    5,070 ms | Fail for diarization/conversation                      |
| Service vocabulary          |   11,300 |      1 |         n/a |      n/a |      1,965 ms |    8,037 ms | Vocabulary mostly pass, benchmark score not applicable |

## Evidence details

### Fan / room noise

Finals:

```text
OpenAI G2 summary telemetry test.
Proven machine captions are live on the glasses.
I want accurate captions in noisy rooms.
The client asked about website conversion and SEO.
```

Score:

```text
exactMatchRate: 1.00
meanWordErrorRateLite: 0.00
```

Interpretation: OpenAI survived steady room/fan noise well in this run.

### TV/music background

Finals:

```text
OpenAIG2 summary telemetry text
Removing machine captions are live on the left
voice
Just wanted to ask about website version SEO
```

Score:

```text
exactMatchRate: 0.00
meanWordErrorRateLite: 0.65
```

Interpretation: OpenAI was not robust to this background media condition. The run also had a much slower first final (`8,601 ms`). This is a major blocker for any claim of noisy-room superiority.

### Second speaker / interruption

Finals:

```text
OpenAI G2 summary telemetry test.
Proven machine captions are live on the glasses.
How are you doing today, Tony? I hope your day went well. Asked about website conversion and SEO
```

Score:

```text
exactMatchRate: 0.50
meanWordErrorRateLite: 0.857
```

Interpretation: OpenAI captured the interruption, but merged it into the main stream with no speaker separation. This confirms the current OpenAI path is not ready as a conversation-mode replacement for Deepgram because it lacks usable speaker labels/diarization.

### Service vocabulary

Read script:

```text
HVAC water mitigation conversion rate Google Business Profile Even Realities G2 Proven Machine.
```

Final:

```text
HVAC water mitigation conversion rate Google Business Profile even realities G2 proven machine.
```

Interpretation: Strong vocabulary result. OpenAI preserved `HVAC`, `Google Business Profile`, and `G2`; casing of `Even Realities` / `Proven Machine` was normalized lower-case, but word content was correct.

## Product read

OpenAI is promising for precision vocabulary in quiet/steady-noise contexts, but it failed the two most product-critical hard cases:

1. background TV/music,
2. nearby second speaker / interruption.

Current recommendation remains:

```text
Deepgram = default/product conversation mode
OpenAI = experimental precision vocabulary mode
```

Do not claim OpenAI is better than Conversate or Deepgram for noisy/multi-speaker captioning yet.

## Next OpenAI work

Recommended next engineering path:

1. Add an OpenAI-specific vocabulary benchmark mode so service-vocabulary scripts are scored against the right expected text.
2. Compare the same TV/music and second-speaker hard conditions against Deepgram.
3. Investigate whether OpenAI offers session/transcription options for noise robustness without manual periodic commits.
4. Consider a post-ASR phrase aggregator only for OpenAI fragmented finals, but not as a substitute for speaker diarization.
