# Phase 14 — ElevenLabs Scribe v2 realtime smoke

Date: 2026-05-04
Status: Fixture smoke verified and explicit `?asr=elevenlabs` live-provider test path added. Deepgram remains the default provider.

## Why

Tony is unhappy with Deepgram's current behavior and asked to test ElevenLabs Scribe v2 before proceeding. This spike validates the realtime API shape against the same `speech-smoke.pcm` fixture, then adds a gated live-provider path for a real G2 comparison without switching production defaults.

## Scope

Two paths now exist:

```bash
npm run smoke:elevenlabs
```

This local terminal script:

- reads `ELEVENLABS_API_KEY` from `.env` or the shell;
- keeps the API key server-side in the local Node process;
- streams `public/fixtures/speech-smoke.pcm` as `pcm_16000`;
- sends ElevenLabs `input_audio_chunk` JSON messages with base64 audio;
- uses `scribe_v2_realtime` with VAD commit strategy;
- requests timestamped committed transcripts;
- biases keyterms toward `ProvenMachine` and `Even Realities G2`;
- prints a JSON smoke result.

For WebView/G2 testing, the app now supports an explicit test flag:

```text
?asr=elevenlabs
```

With that flag:

- the WebView calls the local/deployed broker at `/elevenlabs/token`;
- the broker mints a single-use ElevenLabs realtime Scribe token with the server-side `ELEVENLABS_API_KEY`;
- the WebView opens `wss://api.elevenlabs.io/v1/speech-to-text/realtime` with the single-use token;
- audio chunks from the existing fixture, browser mic, or G2 SDK mic path are sent as JSON/base64 `input_audio_chunk` messages;
- visual status/error behavior remains mandatory.

Without `?asr=elevenlabs`, the app remains on the existing Deepgram path.

## First fixture result

Fixture: `public/fixtures/speech-smoke.pcm`
Expected: `ProvenMachine captions are ready.`

Observed first successful smoke:

```json
{
  "provider": "elevenlabs",
  "model": "scribe_v2_realtime",
  "fixture": "speech-smoke.pcm",
  "chunkCount": 20,
  "firstCommittedFromFirstAudioMs": 2052,
  "finalText": "ProvenMachine captions are ready.",
  "events": [
    { "atMs": 213, "messageType": "session_started" },
    {
      "atMs": 2262,
      "messageType": "committed_transcript",
      "text": "ProvenMachine captions are ready."
    },
    {
      "atMs": 2328,
      "messageType": "committed_transcript_with_timestamps",
      "text": "ProvenMachine captions are ready."
    }
  ]
}
```

Latest re-run after adding the live-provider path also succeeded:

```text
finalText: ProvenMachine captions are ready.
firstCommittedFromFirstAudioMs: 2127
messages: session_started -> committed_transcript -> committed_transcript_with_timestamps
```

## Notes

- Accuracy on the clean fixture was perfect.
- No `partial_transcript` event appeared on this short fixture; the first usable text was committed text after roughly 2.0–2.1s from first audio send.
- No speaker IDs were present in this single-speaker fixture. This does not answer the open diarization question.
- The direct WebView connection uses a single-use token; raw ElevenLabs API keys remain server-side only.
- The Even Hub manifest now includes `https://api.elevenlabs.io` and `wss://api.elevenlabs.io` for the gated ElevenLabs test path.

## Real G2 comparison command shape

For local hardware testing, run the broker with the same LAN pattern used by Deepgram, then open the app with the explicit provider flag:

```bash
set -a && . ./.env && set +a && HOST=0.0.0.0 npm run token-broker
npm run dev -- --host 0.0.0.0 --port 5173
```

Then QR/open a URL like:

```text
http://<LAN-IP>:5173/?autoSmoke=0&debug=1&asr=elevenlabs
```

Use the same phrase set and same room conditions as Deepgram. Capture telemetry JSON and client logs for:

- first partial / first usable text latency;
- final/committed transcript latency;
- WER;
- caption stability;
- speaker IDs / diarization;
- keyterm hit rate;
- cost and API error behavior.

Do not switch production from Deepgram until this comparison includes real G2 mic audio, especially two-speaker audio.
