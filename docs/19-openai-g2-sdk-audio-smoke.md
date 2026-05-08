# OpenAI G2 SDK audio smoke

Date: 2026-05-08

## Purpose

Validate the approved hardware gate for routing Even Realities G2 SDK microphone PCM through the G2 Captions WebView app into the experimental OpenAI realtime ASR provider.

This is hardware-path evidence, not a product/default-provider decision. Deepgram remains the default/product ASR provider until OpenAI has speaker-label and noisy-conversation evidence comparable to Deepgram and Conversate.

## Setup

- App URL: `http://192.168.1.205:5173/?asr=openai&autoSmoke=0&debug=1`
- Active Mac interface: `en6`
- Active Mac LAN IP: `192.168.1.205`
- App server: built `dist/` served by `python3 -u -m http.server 5173 --bind 0.0.0.0 --directory dist`
- Broker: `HOST=0.0.0.0 ... npm run token-broker`
- OpenAI provider: explicit `?asr=openai`
- OpenAI API key: server-side broker only; no raw key printed or exposed to WebView

Earlier IP `192.168.0.89` was wrong for the phone/Even Hub because the Mac was not associated with Wi-Fi. The default route was on `en6`, producing `192.168.1.205`.

## Result

The G2 SDK audio path was reached.

Client logs confirmed:

- app was loaded from `http://192.168.1.205:5173/?asr=openai&autoSmoke=0&debug=1`
- G2 SDK audio PCM events were received by the WebView
- each PCM chunk was sent to the OpenAI ASR session adapter
- OpenAI produced partial transcript events and final transcript events
- captions were formatted and display updates were sent for each partial/final event
- G2 audio source stop closed cleanly

Exact final transcripts from the telemetry JSON:

```text
We are now testing on the Even Realities G2 glasses.
I want to make sure that it is capturing every word I am saying.
```

Telemetry metrics:

```json
{
  "firstPartialFromFirstAudioMs": 2818,
  "finalTranscriptFromFirstAudioMs": 5596,
  "displayUpdateFromFinalTranscriptMs": 1
}
```

Representative retained log stages:

```text
g2_audio_pcm_received
g2_sdk_audio_chunk_send_start
g2_sdk_audio_chunk_send_done
first_partial_received transcript=" We"
final_transcript_received transcript="We are now testing on the Even Realities G2 glasses."
final_transcript_received transcript="I want to make sure that it is capturing every word I am saying."
speaker_label_observed status=partial speaker=?
speaker_label_observed status=final speaker=? textLength=64
g2_audio_source_stop_start
g2_audio_listener_unsubscribed
g2_audio_control_close_done
```

Representative PCM details:

```json
{
  "byteLength": 3200,
  "durationMs": 100,
  "inputGain": 4,
  "seq": 153
}
```

The retained broker/client-log buffer held the last 200 entries. Because audio chunks log every 100 ms, earlier setup details were pushed out by the high-volume chunk logs. Antonio separately provided the full telemetry JSON containing the exact partial/final transcripts and metrics above.

## Evidence summary

This run proves the following path works on hardware:

```text
G2 SDK audioEvent.audioPcm
  -> WebView G2 SDK audio source
  -> OpenAI live session sendPcmChunk
  -> local broker /openai/transcribe
  -> OpenAI realtime transcription
  -> partial/final transcript events observed
```

OpenAI speaker remains unknown:

```text
speaker: ?
```

So OpenAI still renders as `[??]` and should remain experimental.

## Limitations

- No controlled noisy-room WER comparison was run in this hardware pass.
- Speaker labels are still not available from the OpenAI realtime path.
- This does not justify replacing Deepgram as default.

## Repeat summary-telemetry run

After adding compact stop-summary telemetry, the OpenAI G2 SDK audio smoke was repeated at:

```text
http://192.168.1.205:5173/?asr=openai&autoSmoke=0&debug=1
```

The app loaded in Even Hub, G2 SDK audio started, captions worked, and stopping live audio emitted the expected compact summary event:

```json
{
  "stage": "g2_sdk_audio_smoke_summary",
  "details": {
    "provider": "openai",
    "fixtureId": "g2-sdk-audio",
    "chunkCount": 149,
    "audioDurationMs": 14900,
    "finalTranscripts": ["OpenAI G2 Summary Telemetry Test", "Proven machine captions are live on the glasses."],
    "metrics": {
      "firstPartialFromFirstAudioMs": 2828,
      "finalTranscriptFromFirstAudioMs": 5558,
      "displayUpdateFromFinalTranscriptMs": 1
    }
  }
}
```

This confirms the hardware smoke evidence is now retrievable from `/client-logs` without relying on manually copied telemetry.

## Deepgram hardware A/B run

The same G2 SDK audio path was tested with Deepgram at:

```text
http://192.168.1.205:5173/?asr=deepgram&autoSmoke=0&debug=1
```

The app loaded in Even Hub, G2 SDK audio started, captions worked, and stopping live audio emitted the same compact summary event shape:

```json
{
  "stage": "g2_sdk_audio_smoke_summary",
  "details": {
    "provider": "deepgram",
    "fixtureId": "g2-sdk-audio",
    "chunkCount": 122,
    "audioDurationMs": 12200,
    "finalTranscripts": ["OpenAI g two summary telemetry test.", "Proven machine captions are live on the glasses."],
    "metrics": {
      "tokenRequestMs": 0,
      "websocketOpenFromStartMs": 69,
      "firstPartialFromFirstAudioMs": 2038,
      "finalTranscriptFromFirstAudioMs": 4697,
      "displayUpdateFromFinalTranscriptMs": 0
    }
  }
}
```

Deepgram also emitted an observed speaker label:

```text
speaker_label_observed { speaker: "0", status: "final", textLength: 48 }
```

## Initial G2 SDK hardware A/B comparison

These two runs were manual and not perfectly time-matched: the OpenAI run captured 14.9s of audio, while the Deepgram run captured 12.2s. Treat this as a smoke-level comparison, not a benchmark.

| Metric                            |    OpenAI |  Deepgram |                       Difference |
| --------------------------------- | --------: | --------: | -------------------------------: |
| Audio duration                    | 14,900 ms | 12,200 ms |             OpenAI run +2,700 ms |
| Chunks                            |       149 |       122 |            OpenAI run +27 chunks |
| First partial from first audio    |  2,828 ms |  2,038 ms |           Deepgram 790 ms faster |
| Final transcript from first audio |  5,558 ms |  4,697 ms |           Deepgram 861 ms faster |
| Display update after final        |      1 ms |      0 ms |                 effectively tied |
| Speaker label                     |       `?` |       `0` | Deepgram has usable label signal |

Transcript comparison:

| Expected phrase                                  | OpenAI                                           | Deepgram                                         |
| ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| OpenAI G2 summary telemetry test.                | OpenAI G2 Summary Telemetry Test                 | OpenAI g two summary telemetry test.             |
| Proven Machine captions are live on the glasses. | Proven machine captions are live on the glasses. | Proven machine captions are live on the glasses. |

Interpretation:

- Both providers successfully transcribed real G2 SDK microphone audio through the app.
- Deepgram was faster on this smoke run and retained a speaker label signal.
- OpenAI preserved `G2` formatting better in the first phrase, while Deepgram rendered it as `g two`.
- Both got the second phrase effectively correct.
- Deepgram remains the safer default/product provider for now because of speed and speaker-label support.

## Strict hardware benchmark mode

A stricter operator mode now exists for repeatable real-G2 provider comparisons:

```text
http://<ACTIVE_IP>:5173/?asr=<provider>&autoSmoke=0&debug=1&mode=hardwareBenchmark
```

Use the default-route LAN IP, not a hardcoded interface. Example for the last successful network:

```text
http://192.168.1.205:5173/?asr=deepgram&autoSmoke=0&debug=1&mode=hardwareBenchmark
http://192.168.1.205:5173/?asr=openai&autoSmoke=0&debug=1&mode=hardwareBenchmark
```

The phone UI shows this fixed script in both production and debug mode:

```text
1. OpenAI G2 summary telemetry test.
2. Proven Machine captions are live on the glasses.
3. I want accurate captions in noisy rooms.
4. The client asked about website conversion and SEO.
```

When the operator taps Stop Live Audio after reading the script, `g2_sdk_audio_smoke_summary` includes the existing provider/chunk/transcript/latency fields plus a `benchmark` score:

```json
{
  "expectedPhraseCount": 4,
  "observedFinalCount": 4,
  "exactMatchCount": 0,
  "exactMatchRate": 0,
  "meanWordErrorRateLite": 0,
  "phrases": [
    {
      "index": 1,
      "expected": "OpenAI G2 summary telemetry test.",
      "observed": "...",
      "exactMatch": false,
      "wordErrorRateLite": 0.4
    }
  ]
}
```

This makes the next Deepgram/OpenAI real-G2 runs comparable without relying on manual transcript scoring. It is still a manual hardware benchmark, not an always-on/background capture flow.

## Strict hardware benchmark results

The strict `mode=hardwareBenchmark` protocol was run on real G2 SDK audio for both Deepgram and OpenAI using the same four-phrase script.

Deepgram URL:

```text
http://192.168.1.205:5173/?asr=deepgram&autoSmoke=0&debug=1&mode=hardwareBenchmark
```

Deepgram scored summary:

```json
{
  "provider": "deepgram",
  "chunkCount": 194,
  "audioDurationMs": 19400,
  "finalTranscripts": [
    "OpenAI G two summary telemetry test.",
    "Proven machine captions are live on the glasses.",
    "I want accurate captions in noisy rooms.",
    "The client asked about website conversion and SEO."
  ],
  "metrics": {
    "websocketOpenFromStartMs": 28,
    "firstPartialFromFirstAudioMs": 1987,
    "finalTranscriptFromFirstAudioMs": 4730,
    "displayUpdateFromFinalTranscriptMs": 0
  },
  "benchmark": {
    "expectedPhraseCount": 4,
    "observedFinalCount": 4,
    "exactMatchCount": 3,
    "exactMatchRate": 0.75,
    "meanWordErrorRateLite": 0.1
  }
}
```

OpenAI URL:

```text
http://192.168.1.205:5173/?asr=openai&autoSmoke=0&debug=1&mode=hardwareBenchmark
```

OpenAI scored summary:

```json
{
  "provider": "openai",
  "chunkCount": 224,
  "audioDurationMs": 22400,
  "finalTranscripts": [
    "OpenAI G2 summary telemetry test.",
    "Proven machine captions are live on the glasses.",
    "I want accurate captions in noisy rooms.",
    "The client asked about website conversion and SEO."
  ],
  "metrics": {
    "firstPartialFromFirstAudioMs": 4049,
    "finalTranscriptFromFirstAudioMs": 6994,
    "displayUpdateFromFinalTranscriptMs": 0
  },
  "benchmark": {
    "expectedPhraseCount": 4,
    "observedFinalCount": 4,
    "exactMatchCount": 4,
    "exactMatchRate": 1,
    "meanWordErrorRateLite": 0
  }
}
```

Strict benchmark comparison:

| Metric                            |  Deepgram |    OpenAI | Takeaway                              |
| --------------------------------- | --------: | --------: | ------------------------------------- |
| Audio duration                    | 19,400 ms | 22,400 ms | OpenAI run captured +3,000 ms         |
| First partial from first audio    |  1,987 ms |  4,049 ms | Deepgram 2,062 ms faster              |
| Final transcript from first audio |  4,730 ms |  6,994 ms | Deepgram 2,264 ms faster              |
| Exact-match rate                  |      0.75 |      1.00 | OpenAI higher on this script          |
| Mean WER-lite                     |      0.10 |      0.00 | OpenAI higher accuracy on this script |
| Display update after final        |      0 ms |      0 ms | tied                                  |

Interpretation:

- Deepgram remained materially faster on real G2 SDK audio.
- OpenAI was exact on all four controlled phrases in this run.
- Deepgram's only scored miss was phrase 1: `G2` became `G two`.
- OpenAI still lacks usable speaker labels in this app path, so this does not justify replacing Deepgram as default.
- This is now a repeatable hardware benchmark pattern, but it is still one controlled phrase script, not noisy multi-speaker Conversate-level evidence.

## Follow-ups

Completed after this run:

- Hardware chunk send logs are now compact: first chunk, every 25th chunk, and the stop summary instead of every 100 ms chunk-send event.
- `AudioController.stop()` now emits a `g2_sdk_audio_smoke_summary` event for G2 SDK audio sessions with chunk count, audio duration, final transcripts, and telemetry metrics.
- A repeat OpenAI G2 SDK audio run confirmed the new summary event is retained with exact transcripts and metrics.
- A Deepgram G2 SDK audio A/B smoke run confirmed the same summary event shape works for Deepgram and provides a first smoke-level comparison against OpenAI.
- `?mode=hardwareBenchmark` now shows a fixed phrase script and adds exact-match/WER-lite scoring to the G2 SDK audio stop summary.
- The strict hardware benchmark was run for both Deepgram and OpenAI. Deepgram was faster; OpenAI scored higher on the four-phrase exact/WER-lite script.

Remaining:

1. Run the strict `mode=hardwareBenchmark` protocol with Deepgram and OpenAI under the same room/device position.
2. Compare both providers against Conversate on real G2 conversations before any product claim.
3. Keep Deepgram default until OpenAI has speaker-label and noisy-room evidence.
