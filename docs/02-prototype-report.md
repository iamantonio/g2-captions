# G2-Captions Phase 2 Initial Prototype Report

Date: 2026-04-29

## Status

Initial phone-side prototype scaffold is complete. This is a fixture-mode prototype only. No vendor API keys, payment-backed accounts, live microphone capture, or cloud audio upload were used.

## Files implemented

- `package.json`
- `tsconfig.json`
- `vite.config.ts`
- `index.html`
- `app.json`
- `src/types.ts`
- `src/captions/formatter.ts`
- `src/captions/CaptionState.ts`
- `src/captions/latency.ts`
- `src/captions/visualErrors.ts`
- `src/vocab/corrector.ts`
- `src/asr/FixtureAsrClient.ts`
- `src/display/phoneDisplay.ts`
- `src/app/main.ts`
- `src/app/runFixturePrototype.ts`
- `tools/run-fixture-prototype.ts`
- `tests/unit/formatter.test.ts`
- `tests/unit/captionState.test.ts`
- `tests/unit/vocab.test.ts`
- `tests/unit/latency.test.ts`
- `tests/integration/asrContract.test.ts`
- `tests/integration/accessibilityFallback.test.ts`

## Implemented behavior

- Caption frame formatter with speaker labels and visual status row.
- Visual-only error messages:
  - `MIC BLOCKED — check permission`
  - `G2 DISCONNECTED — captions on phone`
  - `NETWORK SLOW — offline captions`
- Caption state engine that merges revised partials into the same segment and finalizes without duplicates.
- Unknown speaker fallback displayed as `?`.
- Deterministic custom vocabulary alias correction with correction logs.
- Latency summary for fixture events with <=800 ms target flagging.
- Fixture ASR client that emits ordered partial/final transcript events.
- Phone visual fallback renderer.
- Fixture prototype runner that exercises ASR → vocabulary → caption state → lens formatter → latency summary.
- Even Hub package manifest and `.ehpk` packaging smoke test.

## Verification

### RED state observed

Initial tests were written before production modules existed. `npm test` failed with missing modules for:

- `src/display/phoneDisplay`
- `src/asr/FixtureAsrClient`
- `src/captions/CaptionState`
- `src/captions/formatter`
- `src/captions/latency`
- `src/vocab/corrector`

This verified the tests were active before implementation.

### GREEN state

Command:

```bash
npm test
```

Result:

```text
Test Files  6 passed (6)
Tests       9 passed (9)
```

### Build

Command:

```bash
npm run build
```

Result:

```text
✓ built in 42ms
```

### Fixture prototype

Command:

```bash
npm run prototype
```

Output:

```text
G2 CAPTIONS       LIVE 260ms
A: ProvenMachine is ready on
   G2
NET OK  MIC FIXTURE  ASR FIX
```

Fixture latency output:

```json
{
  "frames": [
    { "seq": 1, "endToEndMs": 360, "withinTarget": true },
    { "seq": 2, "endToEndMs": 500, "withinTarget": true }
  ],
  "p95EndToEndMs": 500,
  "withinTargetRate": 1
}
```

### Even Hub package smoke test

Command:

```bash
evenhub pack app.json dist -o g2-captions.ehpk
```

Result:

```text
Successfully packed g2-captions.ehpk (1133 bytes)
```

Package:

```text
/Users/tony/Dev/EvenApps/g2-captions/g2-captions.ehpk
```

## Known limitations

- No live microphone capture yet.
- No Even Hub SDK audio event integration yet.
- No G2 simulator/hardware display smoke test yet.
- No AssemblyAI/Deepgram/Speechmatics live API integration yet.
- No WER scoring against public datasets yet.
- Fixture latency is synthetic and cannot be used to claim target compliance.
- The current `app.json` uses `permissions: []`; live vendor ASR will require approved network permissions and CORS/auth design.

## Safety gate

STOP before vendor API/account work.

Before entering API keys, creating/using payment-backed vendor accounts, or streaming live/private audio to cloud ASR, Tony must approve:

1. Which vendor to wire first: AssemblyAI or Deepgram.
2. Whether to use a local token broker or direct temporary token flow.
3. Which audio is allowed for the first cloud test: synthetic fixture, public dataset clip, or Tony-supplied/private recording.
4. Whether to add network permissions to `app.json` for the selected vendor origin.
