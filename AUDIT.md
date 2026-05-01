# Audit — g2-captions

## Stack & Architecture

TypeScript-strict, ESM-only browser/Node project. Vite 6 builds the WebView bundle from `index.html` → `src/app/main.ts`; Vitest 3 runs in node env from `vite.config.ts`. The runtime artifact is an Even Hub plugin (`app.json` → `com.antoniovargas.g2captions`) loaded as a WebView on Even Realities G2 smart glasses; the bundle ships as a `*.ehpk` package. The pipeline is split into independent seams under `src/`: `audio/` (silent fixture, real-speech fixture, opt-in browser mic, opt-in G2 SDK PCM), `asr/` (two parallel vendor implementations — AssemblyAI Universal-3 Pro `u3-rt-pro` over `wss://streaming.assemblyai.com/v3/ws`, and Deepgram Nova-3 over `wss://api.deepgram.com/v1/listen`; Deepgram is wired into `main.ts` as the default), `captions/` (state machine, fixed-width formatter, latency telemetry, visual-error rendering), `display/` (G2 lens via `@evenrealities/even_hub_sdk` plus a phone preview), `vocab/`, `benchmark/`, and `hardware/`. Secrets stay server-side in a Node-only token broker (`tools/assemblyai-token-broker.ts`) that exposes `/deepgram/token`, `/assemblyai/token`, `/client-log`, and a `/deepgram/listen` WebSocket proxy bound by default to `127.0.0.1:8787` (LAN-bindable for hardware smoke). CI is one workflow (`npm ci && npm test && npm run build` on Node 22). 30 source TS files, ~2631 LOC, 21 test files.

## Summary

- Critical: 0 | High: 4 | Medium: 17 | Low: 22

## Findings

### Security & secrets handling

#### [HIGH] — Token broker mints streaming tokens without per-request authorization

- **Location:** [tools/assemblyai-token-broker.ts:64-91](tools/assemblyai-token-broker.ts), [src/asr/AssemblyAiTokenBrokerServer.ts:15-24](src/asr/AssemblyAiTokenBrokerServer.ts)
- **Evidence:** `POST /deepgram/token` (and `/assemblyai/token`) returns a real streaming token to any caller whose request passes `isAllowedTokenBrokerOrigin`. The only gate is the `Origin` header — and `if (!origin) return true` (`AssemblyAiTokenBrokerServer.ts:16`) lets non-browser callers (curl, scripts) through with no Origin set at all.
- **Impact:** Anyone reachable on the loopback or LAN bind (the hardware-smoke flow runs `HOST=0.0.0.0 npm run token-broker` per `hardware/readiness.ts:43`) can mint Deepgram/AssemblyAI streaming tokens at will. No per-token tracking, no rate limiting (see O-8). The vendor account-holder pays for whatever those tokens stream.

#### [HIGH] — Deepgram WebSocket proxy forwards arbitrary client query parameters upstream

- **Location:** [src/asr/DeepgramProxy.ts:3-8](src/asr/DeepgramProxy.ts), [tools/assemblyai-token-broker.ts:120-122](tools/assemblyai-token-broker.ts)
- **Evidence:** `buildDeepgramProxyUpstreamUrl` does `upstream.search = incoming.search` — every query parameter from the browser's WebSocket URL is copied verbatim onto the upstream `wss://api.deepgram.com/v1/listen` URL, with no allowlist of permitted parameters or model values.
- **Impact:** A LAN-reachable caller can pin the proxy to whatever Deepgram model/feature combination they choose (`model=nova-3-medical`, premium add-ons, oversized `keyterm` lists, etc.) and consume the broker operator's Deepgram credits at the most expensive tier. Also widens the attack surface for any future Deepgram parameter that has side effects.

#### [MEDIUM] — Origin allowlist is bypassed by missing `Origin` header

- **Location:** [src/asr/AssemblyAiTokenBrokerServer.ts:15-24](src/asr/AssemblyAiTokenBrokerServer.ts)
- **Evidence:** `if (!origin) return true`. CORS treats absent Origin as same-origin/non-CORS, but the broker uses this check as its authorization boundary for both HTTP routes and the WS upgrade path (`tools/assemblyai-token-broker.ts:31, 109`).
- **Impact:** Origin is trivially settable by any non-browser client (`curl`, scripts) — the allowlist is decorative against anyone who doesn't go through a browser. Combined with HIGH-1 above, a LAN attacker doesn't need to spoof Origin at all; they can just omit it.

#### [MEDIUM] — `validateAssemblyAiToken` regex doesn't match real AssemblyAI key shape

- **Location:** [src/asr/AssemblyAiStreamingClient.ts:39-45](src/asr/AssemblyAiStreamingClient.ts)
- **Evidence:** `if (!trimmed || /^sk[_-]/i.test(trimmed)) { throw new Error('AssemblyAI streaming requires a temporary token; never embed an API key in the WebView') }`.
- **Impact:** AssemblyAI API keys are 32-character hex (matching the shape of the value seen in `.env`), not OpenAI-style `sk_*`. The validator never fires for an actual leaked key, so it provides no real defense — yet the error message claims it does. False sense of safety against the project's stated non-negotiable "API keys must never be embedded in the WebView."

#### [MEDIUM] — `.env.example` omits `DEEPGRAM_API_KEY` despite Deepgram being the default vendor

- **Location:** [.env.example:1-5](.env.example), [tools/assemblyai-token-broker.ts:10](tools/assemblyai-token-broker.ts), [src/app/main.ts:5,175](src/app/main.ts)
- **Evidence:** `.env.example` documents only `ASSEMBLYAI_API_KEY=your_assemblyai_api_key_here`. The broker reads `readDeepgramApiKeyFromEnv(process.env)` at startup and `main.ts` wires `DeepgramLiveSession` as the only ASR session class.
- **Impact:** Anyone setting up from `.env.example` will boot the broker without `DEEPGRAM_API_KEY`; `readDeepgramApiKeyFromEnv` throws (`DeepgramTokenBroker.ts:27`), and the documented `Connect Deepgram` flow fails on first use. Encourages developers to skip `.env.example` and copy a working `.env` from elsewhere — a worse long-term secret-handling pattern.

#### [MEDIUM] — Hardware smoke auto-runs live ASR on app boot when bridge is detected

- **Location:** [src/app/runtimeConfig.ts:24-27](src/app/runtimeConfig.ts), [src/app/main.ts:48-51](src/app/main.ts)
- **Evidence:** `shouldAutoRunHardwareSmoke(locationUrl, hasEvenBridge)` returns `hasEvenBridge` unless the page URL has `?autoSmoke=0`. `initializeG2Display` then calls `runHardwareSpeechSmoke()` which calls `connectDeepgram()` and streams the speech fixture immediately.
- **Impact:** Opening the WebView on G2 (or any Even Hub-bridged context) silently mints a Deepgram token and streams an audio fixture without an explicit user action. Tony's `DECISIONS.md` D-0006 / G-0003 explicitly require approval before live cloud audio; this default makes the audit-trail signal "user clicked Connect" no longer reliable. Billable activity occurs from page load, not from the visible buttons.

#### [LOW] — Manifest network whitelist does not match what the WebView actually connects to

- **Location:** [app.json:9-15](app.json), [src/app/runtimeConfig.ts:1-12](src/app/runtimeConfig.ts), [tests/integration/manifestPermissions.test.ts:9-15](tests/integration/manifestPermissions.test.ts)
- **Evidence:** `whitelist: ['https://api.deepgram.com']`. But the WebView's actual outbound calls are `http://<host>:8787/deepgram/token`, `ws://<host>:8787/deepgram/listen`, and `http://<host>:8787/client-log` (resolved by `runtimeConfig.ts`). The WebView never connects to `api.deepgram.com` directly — that's the broker (server-side).
- **Impact:** Either Even Hub silently allows loopback/LAN regardless of whitelist (in which case the whitelist entry is decorative), or the whitelist is wrong and the WebView is blocked on real hardware from reaching its own broker. The integration test asserts the current shape exactly, so a fix can't be made without updating both.

### Architecture & code quality

#### [MEDIUM] — `src/app/main.ts` mixes too many concerns in one 329-line file

- **Location:** [src/app/main.ts:1-329](src/app/main.ts)
- **Evidence:** One module owns: Even Hub bridge bootstrap (`initializeG2Display`), DOM rendering (`renderShell`, `renderTelemetryReport`), button wiring for six controls (lines 88-141), ASR session lifecycle (`connectDeepgram`, `ensureDeepgramConnected`, `streamSpeechFixture`, `streamSilentFixture`), audio source orchestration (`startBrowserMicrophone`, `startG2SdkAudio`, `stopLiveAudio`), telemetry recording, structured client logging (`logClientStage`), and visual-status broadcasting.
- **Impact:** This is the only file in the codebase with no test (T-1). State is held in module-level mutable variables (`session`, `g2Display`, `g2AudioBridge`, `liveAudioSource`, `lastFrameText`, `currentVisualStatus`, `telemetry`) so it can't be unit-tested without a DOM. Every change to ASR or audio touches the same file.

#### [MEDIUM] — `AssemblyAiLiveSession` and `DeepgramLiveSession` are ~80% duplicated

- **Location:** [src/asr/AssemblyAiLiveSession.ts:29-171](src/asr/AssemblyAiLiveSession.ts), [src/asr/DeepgramLiveSession.ts:30-174](src/asr/DeepgramLiveSession.ts)
- **Evidence:** Both classes have effectively identical implementations of `connect`, `streamPcmChunks` (lines 81-97 vs 80-96, character-for-character match except for the vendor name in a status string), `sendPcmChunk`, `terminate`, `markTelemetry`, the constructor's optional-injection pattern, and `fetchTemporaryToken`. The only real divergences are URL builder, terminate-message builder, response-payload key (`token` vs `accessToken`), and one extra subprotocol arg on the Deepgram WS.
- **Impact:** A bug fix (e.g., adding reconnection, or fixing the swallowed-catch O-1) has to land twice. Drift is already happening — `AssemblyAiLiveSession.ts:125` keeps `error` in the catch but doesn't use it, while `DeepgramLiveSession.ts:129` drops it.

#### [MEDIUM] — `AssemblyAiStreamingClient` and `DeepgramStreamingClient` duplicate mapping helpers

- **Location:** [src/asr/AssemblyAiStreamingClient.ts:104-114](src/asr/AssemblyAiStreamingClient.ts), [src/asr/DeepgramStreamingClient.ts:125-137](src/asr/DeepgramStreamingClient.ts)
- **Evidence:** Both files re-declare `optionalNumber`, an `optionalString`/`optionalSpeaker` variant, and a vendor-specific number-coercion helper (`numberOr` vs `secondsToMsOr`), plus near-identical "find first/last word with finite timing" logic (AssemblyAi:85-86 vs Deepgram:96-97).
- **Impact:** Same drift risk as A-2. Adds friction when introducing the planned third vendor (Speechmatics — `DECISIONS.md` D-0005).

#### [MEDIUM] — Token broker filename and module name still say "AssemblyAi" but serve both vendors

- **Location:** [tools/assemblyai-token-broker.ts:1-178](tools/assemblyai-token-broker.ts), [src/asr/AssemblyAiTokenBrokerServer.ts:1-30](src/asr/AssemblyAiTokenBrokerServer.ts)
- **Evidence:** The file is the only broker in the project — it imports `createDeepgramToken`, builds the Deepgram WS proxy, and calls itself "Deepgram token/proxy broker" in its startup log (`tools/assemblyai-token-broker.ts:176`). The shared helper module is named `AssemblyAiTokenBrokerServer.ts` but exports `getTokenBrokerBindHost` / `getTokenBrokerCorsOrigin` / `isAllowedTokenBrokerOrigin` used by both vendors. Env var `ASSEMBLYAI_TOKEN_BROKER_PORT` (line 8) is the _only_ way to set the broker port.
- **Impact:** New contributors looking for "the Deepgram broker" don't find it. The npm script `token-broker` (`package.json:13`) doesn't say which vendor. Misnamed env var also bleeds the AssemblyAI-only history into the current Deepgram-default config.

#### [MEDIUM] — `CaptionState` segment ID collides on simultaneous speakers

- **Location:** [src/captions/CaptionState.ts:8-26](src/captions/CaptionState.ts)
- **Evidence:** `const id = ${event.startMs}` — speaker is intentionally not part of the key (`byStartSpeaker` map name notwithstanding). Two `RawAsrEvent`s with the same `startMs` but different `speaker` overwrite each other.
- **Impact:** Diarization is part of the stated quality bar (`>=2 speaker labels`, `DECISIONS.md` D-0002). Crosstalk where two speakers begin the same word-boundary millisecond will silently drop one segment. Even single-speaker, two partials with identical `startMs` in the same window now share an id.

#### [LOW] — `runtimeConfig` duplicates host-resolution across three functions

- **Location:** [src/app/runtimeConfig.ts:1-22](src/app/runtimeConfig.ts)
- **Evidence:** Lines 2-3, 8-9, and 15-16 each re-derive `host` and `brokerHost` from `locationUrl` with the same `localhost → 127.0.0.1` rule.
- **Impact:** A change to host resolution (e.g., adding `0.0.0.0` handling) must be made three times.

#### [LOW] — `formatSpeakerChip` produces unexpected labels for non-A/B speakers

- **Location:** [src/captions/formatter.ts:120-127](src/captions/formatter.ts)
- **Evidence:** `if (/^[A-Z]$/.test(trimmed)) return [S${trimmed.charCodeAt(0) - 64}]` maps `A → [S1]`, `B → [S2]`, but also `Q → [S17]`, `Z → [S26]`. `if (/^\d+$/.test(trimmed)) return [S${Number(trimmed) + 1}]` makes `0 → [S1]`, `1 → [S2]` — but the `A-Z` branch already mapped `A → [S1]`, so a Deepgram speaker `0` and an AssemblyAI speaker `A` share the same chip with no warning.
- **Impact:** Speaker-label hit rate (a benchmark metric, `fixtureBenchmark.ts:124`) silently passes when speakers collide on the chip. Fixtures use `A`/`B`, so unit tests pass — but a real session with three speakers labelled `0`, `1`, `2` and a fourth labelled `A` collides.

#### [LOW] — Browser microphone uses the deprecated `ScriptProcessorNode` API

- **Location:** [src/audio/browserMicrophone.ts:56-78](src/audio/browserMicrophone.ts)
- **Evidence:** `processor = context.createScriptProcessor(4096, 1, 1)`. `ScriptProcessorNode` has been deprecated in the Web Audio API since 2014; modern equivalent is `AudioWorkletNode`.
- **Impact:** Will eventually be removed by browsers; Chrome already prints a console deprecation warning. `ScriptProcessorNode` also runs on the main thread, adding latency vs `AudioWorklet`.

#### [LOW] — Magic input gain `4` for G2 mic without a measurement record

- **Location:** [src/audio/g2SdkAudio.ts:78](src/audio/g2SdkAudio.ts)
- **Evidence:** `const gain = this.options.inputGain ?? 4`. The block comment at lines 18-22 explains _why_ gain exists ("G2 mic PCM can arrive too quiet") but not _why 4_ — no link to a measurement, no fixture, no hardware-smoke note.
- **Impact:** Clipping above 4× gain is silent (saturation in `amplifyPcmS16Le` clamps to ±32767). Without a justification anchor, future tuning is guesswork.

#### [LOW] — Caption-frame footer regex coupling to dash-replace step is brittle

- **Location:** [src/captions/formatter.ts:48-65](src/captions/formatter.ts)
- **Evidence:** Line 48 normalizes em/en dashes to `-`, then the `statusMap` patterns only match the _post-replacement_ form (`/^CONNECTING - token/i`). If a caller emits an em-dash status (which `main.ts` does — e.g. `'CONNECTING — token'`), the footer-mapping depends on the sanitize step running first.
- **Impact:** Anyone factoring out the sanitize logic without updating the regex map breaks the lens footer silently.

#### [LOW] — `G2LensDisplay.render` recurses when first frame matches the startup constant

- **Location:** [src/display/g2LensDisplay.ts:67-74](src/display/g2LensDisplay.ts)
- **Evidence:** After successful startup, `if (lensContent === G2_STARTUP_CONTENT) return { ok: true }; return this.render(lensContent)` — the recursive arm only triggers when the user's first frame is _not_ equal to `'G2 CAPTIONS\nSTARTING'`. Always 1 deep, but unguarded.
- **Impact:** Edge case where an upstream caller sends the literal startup text as a real caption returns `{ ok: true }` without actually drawing it on the lens.

#### [LOW] — Vocabulary corrector has no overlap-protection between entries

- **Location:** [src/vocab/corrector.ts:13-21](src/vocab/corrector.ts)
- **Evidence:** Outer loop iterates priority-sorted entries; inner loop iterates each entry's aliases and runs `corrected.replace(pattern, ...)` on the rolling `corrected` string. If a higher-priority entry's canonical replacement happens to match a later entry's alias, double correction can occur.
- **Impact:** Today's vocabulary (`phase22Fixtures.ts:6-10`) has no overlapping aliases, so this is theoretical — but as soon as a vocabulary entry's canonical contains another entry's alias as a substring, corrections can chain.

#### [LOW] — `readJsonBody` accumulates Buffer chunks via string concatenation

- **Location:** [tools/assemblyai-token-broker.ts:14-21](tools/assemblyai-token-broker.ts)
- **Evidence:** `body += String(chunk)` inside `for await (const chunk of request)`. `String(Buffer)` defaults to UTF-8 decoding, which mishandles multi-byte sequences split across chunk boundaries.
- **Impact:** Non-ASCII content in `/client-log` (logs may include user-visible captions) can fail JSON.parse with a 400 response, even though the original request was valid JSON.

### Performance & scalability

#### [MEDIUM] — Every ASR partial triggers a full DOM + lens re-render with no throttling

- **Location:** [src/app/main.ts:179-191](src/app/main.ts), [src/captions/formatter.ts:33-39](src/captions/formatter.ts), [src/display/g2LensDisplay.ts:57-93](src/display/g2LensDisplay.ts)
- **Evidence:** `onTranscript` calls `state.applyAsrEvent(event)` then `renderShell(currentVisualStatus)`. `renderShell` rebuilds all six control buttons, replaces `app.innerHTML`, calls `formatCaptionFrame` (which sorts segments), and triggers `g2Display.render` (which calls `bridge.textContainerUpgrade` over the BLE-backed Even Hub SDK). No coalescing, no animation-frame batching.
- **Impact:** Deepgram with `interim_results=true` (`DeepgramStreamingClient.ts:64`) emits partials at ~50-100ms cadence — the lens path can issue 10-20 BLE writes per second, well over what BLE GATT writes can sustain on G2 (the docs note BLE update budget is the bottleneck for daily-driver captioning). The DOM teardown also detaches/reattaches button event listeners every event.

#### [LOW] — `CaptionState.segments()` and `selectRecentCaptionLines` re-spread + sort on every render

- **Location:** [src/captions/CaptionState.ts:29-31](src/captions/CaptionState.ts), [src/captions/formatter.ts:74](src/captions/formatter.ts)
- **Evidence:** `segments()` returns `[...this.byStartSpeaker.values()].sort(...)`. The formatter then does another `[...segments].sort(...)`. Both are called per ASR event.
- **Impact:** O(n log n) per render for an O(n) caption tail. Becomes meaningful when a session accumulates hundreds of segments, which is realistic for continuous captioning.

#### [LOW] — `applyVocabularyCorrections` rescans the full transcript every event

- **Location:** [src/vocab/corrector.ts:8-23](src/vocab/corrector.ts)
- **Evidence:** Builds a fresh sorted entry list and a fresh `RegExp` per alias on every call. Called from `runFixturePrototype.ts:28` once per event and from `fixtureBenchmark.ts:100` per terminal event.
- **Impact:** O(entries × aliases × text) every call. RegExp compilation dominates for small vocabularies; will cap throughput as vocabulary grows.

#### [LOW] — Pending-message buffer in WS proxy is unbounded

- **Location:** [tools/assemblyai-token-broker.ts:120-150](tools/assemblyai-token-broker.ts)
- **Evidence:** `pendingBrowserMessages: Array<{ data: RawData; isBinary: boolean }> = []`; messages are pushed when upstream is `CONNECTING` (line 149) and flushed on `open`. No length cap, no byte cap.
- **Impact:** A slow upstream connection plus a fast PCM stream (16kHz × 16-bit × 100ms chunks) accumulates several KB per chunk in memory. A misbehaving caller can fill the buffer indefinitely if upstream never opens.

#### [LOW] — Latency/telemetry summarizers rebuild aggregates on every call

- **Location:** [src/captions/latency.ts:91-108](src/captions/latency.ts), [src/captions/latency.ts:110-134](src/captions/latency.ts)
- **Evidence:** `calculateBenchmarkTelemetryMetrics` calls `events.find(...)` seven times per `report()`. `summarizeLatencyBudget` rebuilds a `Map` each call. Both invoked from `renderTelemetryReport` (`main.ts:144-160`) on every render.
- **Impact:** Combined with P-1, every ASR partial does O(7n) telemetry scanning. Minor for prototype scale, scales linearly with session length.

### Test coverage & CI/CD

#### [HIGH] — `src/app/main.ts` (largest source file) has zero tests

- **Location:** [src/app/main.ts:1-329](src/app/main.ts), [tests/](tests/)
- **Evidence:** No test file references `src/app/main` in `tests/unit/` or `tests/integration/`. `main.ts` exports `connectDeepgram, runFixturePrototype, streamSilentFixture, streamSpeechFixture` (line 329) but only `runFixturePrototype` (re-exported from a different module) is tested.
- **Impact:** The visual-status state machine, button wiring, telemetry recorder lifecycle, ASR-session lifecycle (connect → stream → terminate), and the auto-smoke kickoff (S-8) all have no automated coverage. Regressions to the deaf-first-UX invariants (every audio/network/ASR/provider failure must surface visually) cannot be caught by CI for the actual entry point.

#### [HIGH] — Token broker HTTP/WS routes have no integration tests

- **Location:** [tools/assemblyai-token-broker.ts:23-173](tools/assemblyai-token-broker.ts), [tests/](tests/)
- **Evidence:** Tests exist for `AssemblyAiTokenBrokerServer.ts`, `AssemblyAiTokenBroker.ts`, `DeepgramTokenBroker.ts`, `DeepgramProxy.ts` — all helper modules. No test exercises the actual `createServer` route table, the `/client-log` body parser, the `/deepgram/listen` upgrade path, the WS proxy's pending-message buffer flush, or the close-coordination between browser and upstream sockets.
- **Impact:** The most security-sensitive surface (token issuance, WS proxying) is verified only by manual hardware smoke. Bugs in route handling, error responses, or close coordination won't be caught by CI.

#### [MEDIUM] — Visual-fallback test covers 1 of 6 `VisualStatusKind` values

- **Location:** [tests/integration/accessibilityFallback.test.ts:5-13](tests/integration/accessibilityFallback.test.ts), [src/types.ts:49](src/types.ts)
- **Evidence:** Only `g2-disconnected` is asserted. The other five — `mic-blocked`, `network-slow`, `g2-mic-lost`, `asr-lost`, `vocab-loaded` — have no integration test.
- **Impact:** README and CLAUDE.md call deaf-first visual-only failure the project's first non-negotiable. The integration test's name implies enforcement of that rule but only exercises one kind.

#### [MEDIUM] — CI runs no linter, no formatter, no `npm audit`, no coverage report

- **Location:** [.github/workflows/ci.yml:9-21](.github/workflows/ci.yml), [package.json:7-14](package.json)
- **Evidence:** CI is exactly `npm ci && npm test && npm run build`. There is no ESLint config in the repo (no `.eslintrc*`, no `eslint` dep in `package.json`). No Prettier config. No `npm audit` step. `coverage/` is gitignored but never produced (no `vitest --coverage` invocation).
- **Impact:** Style drift, unused vars, dead code, and known dep vulnerabilities can land without signal. The TypeScript strict pass catches type errors but nothing else.

#### [LOW] — No pre-commit framework

- **Location:** repo root (no `.husky/`, no `lint-staged`, no `.pre-commit-config.yaml`)
- **Evidence:** Absent. Solo-dev workflow relies on the developer remembering to run `npm test` before commit.
- **Impact:** Manifest/permission tests and accessibility-fallback tests are guard rails (per CLAUDE.md), but with no client-side enforcement they only catch issues at PR time — and `git push origin main` direct pushes (the user's stated default) skip PR review.

### Dependencies & tech debt

#### [MEDIUM] — No `LICENSE` file at repo root and no license declared in `package.json`

- **Location:** repo root, [package.json:1-27](package.json)
- **Evidence:** No `LICENSE`, `LICENSE.md`, `LICENSE.txt`. `package.json` has no `"license"` field. README has no license section.
- **Impact:** Default copyright is "all rights reserved." Distribution as an Even Hub plugin (the stated goal in `README.md:5`) without a declared license is legally ambiguous for any third party who installs the `.ehpk`. Also blocks open-sourcing.

#### [LOW] — `@evenrealities/even_hub_sdk@^0.0.10` is a pre-1.0 dependency

- **Location:** [package.json:16](package.json)
- **Evidence:** SDK version `^0.0.10`. By npm semver rules, `^0.0.10` means _exactly_ `0.0.10` (no minor/patch allowed without manual bump). The bridge contract is also pre-1.0 by definition.
- **Impact:** Any `0.0.11` release requires a manual `package.json` edit. The SDK API is the only sanctioned BLE write path (D-0003) — pinned hard but with no upstream stability promise.

#### [LOW] — No `CHANGELOG.md` despite explicit project version

- **Location:** repo root, [package.json:3](package.json)
- **Evidence:** `"version": "0.1.0"`. No `CHANGELOG.md`. Phase docs (`docs/00..11`) are sequential and dated but not user-facing release notes.
- **Impact:** Tony's solo workflow has no concise per-version changelog; phase docs are too granular for that role.

#### [LOW] — No automated dependency-update tooling configured

- **Location:** `.github/` (no `dependabot.yml`, no Renovate config)
- **Evidence:** Absent.
- **Impact:** Pre-release pinned SDK (D-2) plus a Vite-major-version-zero ecosystem means deps drift silently between manual `npm install` runs.

#### [LOW] — Built artifact `g2-captions.ehpk` (95 KB) sits in working tree

- **Location:** [g2-captions.ehpk](g2-captions.ehpk), [.gitignore:3](.gitignore)
- **Evidence:** `*.ehpk` is in `.gitignore`; `git ls-files | grep ehpk` returns only `.env.example`-style entries (no `.ehpk` tracked). The file at repo root is 95316 bytes, dated Apr 29.
- **Impact:** Minor, but the artifact accumulates after every `npm run build && evenhub pack ...` and isn't cleaned by any script.

### Observability & error handling

#### [MEDIUM] — Catch blocks swallow original errors at multiple sites

- **Location:** [src/asr/AssemblyAiLiveSession.ts:159-161](src/asr/AssemblyAiLiveSession.ts), [src/asr/DeepgramLiveSession.ts:162-164](src/asr/DeepgramLiveSession.ts), [src/app/main.ts:216-218](src/app/main.ts), [src/app/main.ts:230-232](src/app/main.ts), [src/app/main.ts:238-240](src/app/main.ts), [src/app/main.ts:323-326](src/app/main.ts), [src/audio/browserMicrophone.ts:36-39](src/audio/browserMicrophone.ts), [tools/assemblyai-token-broker.ts:51-54](tools/assemblyai-token-broker.ts), [tools/assemblyai-token-broker.ts:69-72](tools/assemblyai-token-broker.ts), [tools/assemblyai-token-broker.ts:86-89](tools/assemblyai-token-broker.ts)
- **Evidence:** All cited `catch` blocks discard the caught value. Examples: `} catch { this.options.onVisualStatus('ASR MESSAGE FAILED — captions paused') }` (Deepgram WS message parse). The error doesn't even bind to a name in these blocks. `AssemblyAiLiveSession.ts:125, 159` bind `error` but don't use it.
- **Impact:** Operator gets only a static visual string; the original `Error.message`/stack never surfaces. Diagnosis on hardware requires reading code paths and guessing. Notably, `tools/assemblyai-token-broker.ts:69-72` returns HTTP 502 with `{error:'token_generation_failed'}` whether the upstream returned 401, 429, or had a network error — same client response, no server-side log.

#### [MEDIUM] — Logging is unstructured and inconsistent

- **Location:** [src/app/main.ts:31](src/app/main.ts), [tools/assemblyai-token-broker.ts:48,176](tools/assemblyai-token-broker.ts), [tools/run-fixture-prototype.ts:14-15](tools/run-fixture-prototype.ts), [tools/run-fixture-benchmark.ts:22-23](tools/run-fixture-benchmark.ts)
- **Evidence:** Mix of `console.info(\`[g2-captions] ${stage}\`, details)`(browser tag prefix),`console.log('[client-log]', JSON.stringify(entry))`(server, prefixed), and bare`console.log(...)`(CLI runners). No log levels, no shared JSON shape, no separation between operator-visible and developer-visible streams. No`console.error` despite the existence of failure paths.
- **Impact:** Filtering by severity is impossible; structured ingestion (e.g., piping broker logs to a viewer) would need to parse two different formats. Errors caught (per O-1) aren't logged at all.

#### [MEDIUM] — Token broker has no `/health` or readiness endpoint

- **Location:** [tools/assemblyai-token-broker.ts:23-95](tools/assemblyai-token-broker.ts)
- **Evidence:** The route table handles `/client-log`, `/client-logs`, `/deepgram/token`, `/assemblyai/token` and falls through to 404. No `/health`, `/healthz`, `/ready`, `/-/health`, etc.
- **Impact:** `hardware/readiness.ts:48-50` substitutes a real probe with `curl -X OPTIONS`. There's no canonical liveness signal — debugging "broker isn't responding" on G2 hardware smoke requires firing an actual token mint.

#### [MEDIUM] — Broker has no `uncaughtException` / `unhandledRejection` handler

- **Location:** [tools/assemblyai-token-broker.ts:1-178](tools/assemblyai-token-broker.ts)
- **Evidence:** No `process.on('uncaughtException', ...)` or `process.on('unhandledRejection', ...)` registration. `readJsonBody`'s `JSON.parse` is wrapped, but the WS upgrade callback (line 99) and `deepgramProxyServer.on('connection', ...)` (line 120) are not in try/catch and any thrown error inside an event handler crashes the process.
- **Impact:** A malformed WebSocket upgrade can take down the broker silently — Tony has no notification, captions just stop working until `npm run token-broker` is rerun.

#### [LOW] — No graceful shutdown on SIGINT/SIGTERM

- **Location:** [tools/assemblyai-token-broker.ts:175-177](tools/assemblyai-token-broker.ts)
- **Evidence:** `server.listen(port, host, ...)` then nothing. No signal handler closes active WS proxy connections, drains `clientLogs`, or closes the upstream Deepgram sockets.
- **Impact:** Ctrl-C during a live session leaves browser-side WS in `OPEN` until TCP RST, which then surfaces as a generic visual error rather than a clean termination.

#### [LOW] — `/client-log` ingestion logs arbitrary client-controlled JSON

- **Location:** [tools/assemblyai-token-broker.ts:43-55](tools/assemblyai-token-broker.ts)
- **Evidence:** `clientLogs.push(entry); console.log('[client-log]', JSON.stringify(entry))`. No schema validation, no field allowlist.
- **Impact:** A misbehaving WebView can fill broker stdout with arbitrary content. Combined with O-2 (no levels), grep filters are unreliable.

#### [LOW] — `ASSEMBLYAI_TOKEN_BROKER_PORT` is parsed without validation

- **Location:** [tools/assemblyai-token-broker.ts:8](tools/assemblyai-token-broker.ts)
- **Evidence:** `const port = Number.parseInt(process.env.ASSEMBLYAI_TOKEN_BROKER_PORT ?? '8787', 10)`. No `Number.isFinite` / `Number.isInteger` check; `parseInt('not-a-port', 10)` returns `NaN`, and `server.listen(NaN, ...)` throws at runtime.
- **Impact:** Misconfigured env var produces a bare stack trace on broker boot rather than a friendly error.

#### [LOW] — Token mint endpoints have no rate limiting

- **Location:** [tools/assemblyai-token-broker.ts:64-91](tools/assemblyai-token-broker.ts)
- **Evidence:** `POST /deepgram/token` and `POST /assemblyai/token` will mint a fresh streaming token on every call (60s and 60s TTL respectively). No counter, no per-IP/origin throttling.
- **Impact:** Multiplies the impact of S-2 — a single LAN-reachable misbehaving client can mint thousands of tokens per minute, each one billable (AssemblyAI Universal-3 sessions are billed by open WebSocket session duration, per `DECISIONS.md:102`).
