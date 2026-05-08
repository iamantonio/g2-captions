# Deepgram vs OpenAI hard-condition G2 comparison

Date: 2026-05-08

## Purpose

OpenAI `openaiCommitMs=0` showed strong quiet/steady-noise accuracy but failed TV/music and second-speaker conditions. This phase runs the same hard-condition set against Deepgram/default on real Even Realities G2 SDK audio, then compares provider behavior.

## Safety boundary

- Manual foreground G2 SDK audio only.
- API keys remained server-side in the local broker.
- No BLE writes or always-on/background capture.
- Results are smoke evidence, not statistically robust benchmarks.

## URLs

OpenAI prior hard-condition URL:

```text
http://192.168.1.205:5173/?asr=openai&autoSmoke=0&debug=1&mode=hardwareBenchmark&openaiCommitMs=0
```

Deepgram hard-condition URL:

```text
http://192.168.1.205:5173/?asr=deepgram&autoSmoke=0&debug=1&mode=hardwareBenchmark
```

## Results table

| Condition          | Provider | Audio ms | Finals | Exact | WER-lite | First partial | First final | Interpretation                                  |
| ------------------ | -------- | -------: | -----: | ----: | -------: | ------------: | ----------: | ----------------------------------------------- |
| Fan / room noise   | OpenAI   |   21,200 |      4 |  1.00 |     0.00 |      2,052 ms |    4,957 ms | Best accuracy                                   |
| Fan / room noise   | Deepgram |   18,500 |      4 |  0.50 |    0.201 |      1,025 ms |    5,040 ms | Faster partial, phrase-boundary split           |
| TV/music           | OpenAI   |   20,400 |      4 |  0.00 |     0.65 |      1,886 ms |    8,601 ms | Failed, but lower WER than Deepgram             |
| TV/music           | Deepgram |   22,700 |      3 |  0.00 |    1.248 |      1,964 ms |    8,104 ms | Failed, merged phrases                          |
| Second speaker     | OpenAI   |   19,900 |      3 |  0.50 |    0.857 |      2,132 ms |    5,070 ms | Captured interruption but merged streams        |
| Second speaker     | Deepgram |   18,400 |      4 |  0.00 |    0.789 |        964 ms |    5,042 ms | Faster partial, also merged streams             |
| Service vocabulary | OpenAI   |   11,300 |      1 |   n/a |      n/a |      1,965 ms |    8,037 ms | Better vocabulary preservation                  |
| Service vocabulary | Deepgram |   10,600 |      2 |   n/a |      n/a |      1,061 ms |    5,012 ms | Faster, but `G2` -> `g two`, `Profile` -> `Pro` |

Note: service vocabulary was read from a different script than the fixed four benchmark phrases, so exact/WER values from the fixed benchmark are not meaningful for that row.

## Evidence details

### Fan / room noise

OpenAI finals:

```text
OpenAI G2 summary telemetry test.
Proven machine captions are live on the glasses.
I want accurate captions in noisy rooms.
The client asked about website conversion and SEO.
```

Deepgram finals:

```text
OpenAI G2 Summary Telemetry Test
Proven machine captions are live on the glasses. I want accurate
captions in noisy rooms.
The client asked about website conversion and SEO.
```

Interpretation: OpenAI was cleaner on phrase boundaries and exact scoring. Deepgram had faster first partial but split/merged phrases 2–3.

### TV/music background

OpenAI finals:

```text
OpenAIG2 summary telemetry text
Removing machine captions are live on the left
voice
Just wanted to ask about website version SEO
```

Deepgram finals:

```text
Open AIG two summary telemetry test. Proven machine captions are live
on the glasses. I want accurate captions in noisy rooms.
A client asked about website conversion and SEO.
```

Interpretation: both providers failed the background-media condition. OpenAI had lower WER-lite in this run; Deepgram retained more of phrases 2–4 but badly merged phrase boundaries and changed `G2` to `G two`.

### Second speaker / interruption

OpenAI finals:

```text
OpenAI G2 summary telemetry test.
Proven machine captions are live on the glasses.
How are you doing today, Tony? I hope your day went well. Asked about website conversion and SEO
```

Deepgram finals:

```text
OpenAI g two summary
telemetry test. Proven machine captions How are you doing today, Tony? I hope
day went well. Captions in noisy rooms. The client asked
about website conversion and SEO.
```

Interpretation: neither current path solved conversation-mode separation. OpenAI preserved the first two phrases exactly, then merged the second speaker with phrase 4. Deepgram reacted faster, but also merged interruption content and split expected phrases. This reinforces that speaker-label/diarization handling is the key blocker, not only raw ASR quality.

### Service vocabulary

Read script:

```text
HVAC water mitigation conversion rate Google Business Profile Even Realities G2 Proven Machine.
```

OpenAI final:

```text
HVAC water mitigation conversion rate Google Business Profile even realities G2 proven machine.
```

Deepgram finals:

```text
HVAC water mitigation conversion rate Google Business Pro
even realities g two proven machine.
```

Interpretation: OpenAI was clearly better for this vocabulary script. It preserved `Google Business Profile` and `G2`; Deepgram shortened `Profile` to `Pro` and rendered `G2` as `g two`.

## Product conclusion

Current evidence supports this provider split:

```text
Deepgram = default/product conversation mode because it is faster and has the existing speaker-label-oriented path.
OpenAI = experimental precision vocabulary mode because it preserves domain terms better in quiet/steady-noise settings.
```

Do not claim either provider is robust enough for noisy TV/music or true multi-speaker Conversate replacement yet. Both failed key hard conditions on real G2 SDK audio.

## Recommended next work

1. Add a service-vocabulary benchmark mode with its own expected phrases so vocabulary scripts score correctly.
2. Improve phrase-boundary evaluation so merged/split correct words are not over-penalized when judging pure WER.
3. Investigate diarization/speaker-label evidence more directly: capture actual speaker IDs per final and render them in the summary.
4. Test Deepgram endpointing/keyterm tuning for `G2`, `Google Business Profile`, `Even Realities`, and `Proven Machine`.
5. Keep OpenAI `openaiCommitMs=0`; periodic commits fragmented transcripts and should remain off.
