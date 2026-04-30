# Fix Plan — g2-captions

## Summary

| #  | Title | Wave | Severity | Effort | Risk | Depends on |
|----|-------|------|----------|--------|------|------------|
| 1  | Add LICENSE file and `package.json` license field | Quick Win | Medium | S | Low | — |
| 2  | Add `DEEPGRAM_API_KEY` to `.env.example` | Quick Win | Medium | S | Low | — |
| 3  | Create `CHANGELOG.md` | Quick Win | Low | S | Low | — |
| 4  | Add `npm run clean` script for `*.ehpk` artifact | Quick Win | Low | S | Low | — |
| 5  | Document `inputGain = 4` magic number | Quick Win | Low | S | Low | — |
| 6  | Decouple footer formatter from dash-replace step | Quick Win | Low | S | Low | — |
| 7  | Fix `G2LensDisplay.render` startup-content edge case | Quick Win | Low | S | Low | — |
| 8  | Fix `formatSpeakerChip` non-A/B speaker collision | Quick Win | Low | S | Low | — |
| 9  | Add overlap-protection to vocabulary corrector | Quick Win | Low | S | Low | — |
| 10 | Use `Buffer.concat` in `readJsonBody` | Quick Win | Low | S | Low | — |
| 11 | Extract host-resolution helper in `runtimeConfig` | Quick Win | Low | S | Low | — |
| 12 | Composite key for `CaptionState` segment ID | Quick Win | Medium | S | Low | — |
| 13 | Cache compiled regex in vocab corrector | Quick Win | Low | S | Low | — |
| 14 | Cap pending-message buffer in WS proxy | Quick Win | Low | S | Low | — |
| 15 | Memoize telemetry summary | Quick Win | Low | S | Low | — |
| 16 | Validate `TOKEN_BROKER_PORT` parse | Quick Win | Low | S | Low | — |
| 17 | Replace `validateAssemblyAiToken` regex with real key shape | Quick Win | Medium | S | Low | — |
| 18 | Reconcile manifest network whitelist (spike) | Quick Win | Low | S | Low | — |
| 19 | Flip auto-smoke default to opt-in | Quick Win | Medium | S | Low | — |
| 20 | Add Dependabot config | Quick Win | Low | S | Low | — |
| 21 | Document Even Hub SDK pinning policy | Quick Win | Low | S | Low | — |
| 22 | Parametric `VisualStatusKind` integration tests | Quick Win | Medium | S | Low | — |
| 23 | Add ESLint flat config + Prettier + coverage + `audit-ci` to CI | Structural | Medium | M | Low | — |
| 24 | Add pre-commit hook (husky + lint-staged) | Structural | Low | S | Low | #23 |
| 25 | Add token broker integration tests (`superwstest`) | Structural | High | M | Low | — |
| 26 | Adopt Pino structured logging | Structural | Medium | M | Low | — |
| 27 | Bind catch errors and log with structured logger | Structural | Medium | M | Low | #26 |
| 28 | Add `GET /healthz` endpoint | Structural | Medium | S | Low | #26 |
| 29 | Add `uncaughtException` / `unhandledRejection` handlers | Structural | Medium | S | Low | #26 |
| 30 | Add `SIGINT`/`SIGTERM` graceful shutdown | Structural | Low | S | Low | #29 |
| 31 | Validate `/client-log` payloads | Structural | Low | S | Low | #26 |
| 32 | Rate limit token endpoints | Structural | Low | S | Low | — |
| 33 | Rename token broker files to vendor-neutral | Structural | Medium | M | Low | — |
| 34 | Pre-shared bearer token between WebView and broker | Structural | High | M | Med | #25 |
| 35 | Origin defense-in-depth alongside bearer token | Structural | Medium | S | Low | #34 |
| 36 | Server-side fixed parameter set in Deepgram proxy | Structural | High | S | Low | #25 |
| 37 | Refactor `main.ts` into discrete modules | Long-Term | Medium | L | Med | #25, #26 |
| 38 | Add unit tests for refactored entry-point modules | Long-Term | High | M | Low | #37 |
| 39 | Strategy pattern for `LiveAsrSession` (vendor adapter) | Long-Term | Medium | L | Med | #25 |
| 40 | Extract shared ASR parse helpers | Long-Term | Medium | S | Low | #39 |
| 41 | Debounce partials / immediate finals (BLE rate cap) | Long-Term | Medium | M | Med | #37 |
| 42 | Cache `CaptionState.segments()` snapshot | Long-Term | Low | S | Low | #41 |
| 43 | Migrate browser microphone to `AudioWorkletNode` | Long-Term | Low | L | Med | — |

---

## Wave 1 — Quick Wins

**Rationale:** All 22 fixes here are low-risk, ship-in-isolation, and individually under two hours. They include doc/config additions (LICENSE, CHANGELOG, Dependabot), trivial bug fixes (footer regex coupling, speaker chip collision, broker port validation), tiny targeted patches to standalone modules (composite keys, buffer concat, host helper extraction), and the `auto-smoke` default flip — which closes a documented non-negotiable. None of these depend on the broker's auth/observability redesign or the entry-point refactor in later waves, so they can be merged in any order. Because they're individually inexpensive and combined are very high-value, this wave is the right place to retire the long Low-severity tail before structural work begins.

### Fix #1 — Add LICENSE file and `package.json` license field
- **Source:** AUDIT.md → Dependencies & tech debt → D-1
- **Severity:** Medium
- **Files affected:** new `LICENSE` (root), `package.json`, optional `README.md` license section
- **Approach:** Write `LICENSE` (Apache-2.0 boilerplate, per RESEARCH.md recommendation; or `UNLICENSED` interim if Tony hasn't decided open-sourcing). Set `"license": "Apache-2.0"` (or `"UNLICENSED"`) in `package.json`. Add a short README license section pointing to the file.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** `cat LICENSE` shows full text; `node -e "console.log(require('./package.json').license)"` returns the chosen string; `npm pack --dry-run` no longer warns about missing license.

### Fix #2 — Add `DEEPGRAM_API_KEY` to `.env.example`
- **Source:** AUDIT.md → Security & secrets handling → S-6
- **Severity:** Medium
- **Files affected:** `.env.example`
- **Approach:** Append `DEEPGRAM_API_KEY=your_deepgram_api_key_here` and a comment line above it. Document any other required env vars in the same file (e.g., `BROKER_AUTH_TOKEN` once Fix #34 lands; not in this fix's scope).
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** Fresh setup walkthrough: `cp .env.example .env`, fill in real values, run `npm run token-broker` — broker boots without a `DEEPGRAM_API_KEY must be set` error.

### Fix #3 — Create `CHANGELOG.md`
- **Source:** AUDIT.md → Dependencies & tech debt → D-3
- **Severity:** Low
- **Files affected:** new `CHANGELOG.md` (root)
- **Approach:** Bootstrap with the [Keep a Changelog](https://keepachangelog.com) format. Backfill `## [0.1.0] - 2026-04-29` with the four existing commits' user-visible deltas; add an `## [Unreleased]` section at the top.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** `head -30 CHANGELOG.md` shows the standard structure; `git log --oneline` commits map to the documented entries.

### Fix #4 — Add `npm run clean` script for `*.ehpk` artifact
- **Source:** AUDIT.md → Dependencies & tech debt → D-5
- **Severity:** Low
- **Files affected:** `package.json`
- **Approach:** Add `"clean": "rm -f *.ehpk && rm -rf dist artifacts coverage"` (or equivalent cross-platform via `rimraf`). Document in `README.md`. This is housekeeping — not invoked from CI.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** `npm run build && evenhub pack ...` produces an ehpk; `npm run clean` removes it; `git status` is clean afterwards.

### Fix #5 — Document `inputGain = 4` magic number
- **Source:** AUDIT.md → Architecture & code quality → A-9
- **Severity:** Low
- **Files affected:** `src/audio/g2SdkAudio.ts:78`
- **Approach:** Replace the `?? 4` with a named const `DEFAULT_G2_INPUT_GAIN = 4` plus a one-line comment linking to the hardware-smoke note where the value was chosen, or marking it as "TODO: measure on hardware before finalizing." This is documentation-only; behavior is unchanged.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** `npm test` still passes (no behavior change); the constant appears in the file and a code reviewer can trace why `4` was picked.

### Fix #6 — Decouple footer formatter from dash-replace step
- **Source:** AUDIT.md → Architecture & code quality → A-10
- **Severity:** Low
- **Files affected:** `src/captions/formatter.ts:48-65`
- **Approach:** Make `statusMap` patterns match both en/em-dash and ASCII-dash forms, or push the dash normalization into a single guarded helper that the footer mapping calls explicitly. Either way, the coupling becomes a single intentional call rather than two implicit steps.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** Add a unit test that passes an em-dash status (`'CONNECTING — token'`) and asserts the same footer label as the ASCII-dash form.

### Fix #7 — Fix `G2LensDisplay.render` startup-content edge case
- **Source:** AUDIT.md → Architecture & code quality → A-11
- **Severity:** Low
- **Files affected:** `src/display/g2LensDisplay.ts:67-74`
- **Approach:** Remove the `if (lensContent === G2_STARTUP_CONTENT) return { ok: true }` short-circuit. Always proceed to `textContainerUpgrade` after startup succeeds. The recursion guard becomes unnecessary.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** Add a `tests/unit/g2LensDisplay.test.ts` case that calls `render(G2_STARTUP_CONTENT)` after startup and asserts the upgrade path (not the no-op path) executed.

### Fix #8 — Fix `formatSpeakerChip` non-A/B speaker collision
- **Source:** AUDIT.md → Architecture & code quality → A-7
- **Severity:** Low
- **Files affected:** `src/captions/formatter.ts:120-127`
- **Approach:** Introduce a single canonicalization function — accept `A`-`Z`, numeric strings, `S<n>`, and arbitrary fallbacks — and always produce a unique chip. For pure letters, use `[<L>]` (no `S<n>` translation that conflicts with numeric `0`). Add a unit test fixture that covers `A`, `B`, `0`, `1`, `S3`, `?`, and a long string.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** Parametric test in `tests/unit/formatter.test.ts` covers all six listed cases and asserts chip uniqueness across the set.

### Fix #9 — Add overlap-protection to vocabulary corrector
- **Source:** AUDIT.md → Architecture & code quality → A-12
- **Severity:** Low
- **Files affected:** `src/vocab/corrector.ts:8-23`
- **Approach:** Track byte-ranges already-replaced in this pass and skip any later alias whose match overlaps a prior replacement. Order is already priority-sorted, so a single forward pass is sufficient. Document the invariant in a comment.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** Add a unit test with two vocabulary entries where the higher-priority canonical contains the lower-priority alias as a substring; assert no double correction.

### Fix #10 — Use `Buffer.concat` in `readJsonBody`
- **Source:** AUDIT.md → Architecture & code quality → A-13
- **Severity:** Low
- **Files affected:** `tools/assemblyai-token-broker.ts:14-21`
- **Approach:** Accumulate `chunk` Buffers into an array, decode `Buffer.concat(chunks).toString('utf8')` once at the end. Keeps the 10 KB byte cap by tracking `totalLen` as you go.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** Add an integration test (rolls into Fix #25) that POSTs a multi-chunk JSON body containing non-ASCII characters (`ä`, `é`, `中`); body parses correctly.

### Fix #11 — Extract host-resolution helper in `runtimeConfig`
- **Source:** AUDIT.md → Architecture & code quality → A-5
- **Severity:** Low
- **Files affected:** `src/app/runtimeConfig.ts:1-22`
- **Approach:** Add an internal `resolveBrokerHost(locationUrl: URL): string` helper; have `getDefaultTokenEndpoint`, `getDefaultStreamingEndpoint`, and `getClientLogEndpoint` call it.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** `tests/unit/runtimeConfig.test.ts` continues to pass; new test asserts the three callers all return endpoints with the same host part.

### Fix #12 — Composite key for `CaptionState` segment ID
- **Source:** AUDIT.md → Architecture & code quality → A-6
- **Severity:** Medium
- **Files affected:** `src/captions/CaptionState.ts:8-26`
- **Approach:** Per RESEARCH.md A-6 Option A: change `id` from `${event.startMs}` to `${event.speaker?.trim() || '?'}:${event.startMs}`. Existing partial→final coalescing semantics are preserved because both partial and final from the same speaker share the same key.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** Add a unit test with two events sharing `startMs=0` but different speakers (`A`, `B`) — assert `state.segments()` returns two distinct segments after both events apply.

### Fix #13 — Cache compiled regex in vocab corrector
- **Source:** AUDIT.md → Performance & scalability → P-3
- **Severity:** Low
- **Files affected:** `src/vocab/corrector.ts:8-23`
- **Approach:** Hoist the priority sort and `RegExp` compilation out of the per-call hot path. Either (a) memoize by reference identity on the `entries` array, or (b) export a `compileVocabulary(entries)` function that returns a struct of pre-compiled patterns; have callers reuse it across events.
- **Dependencies:** none (pairs naturally with Fix #9 because both touch this function)
- **Effort:** S
- **Risk:** Low
- **Verification:** Add a microbenchmark assertion (or just an `expect.toBeLessThan`) showing the second call is at least 10× faster than the first.

### Fix #14 — Cap pending-message buffer in WS proxy
- **Source:** AUDIT.md → Performance & scalability → P-4
- **Severity:** Low
- **Files affected:** `tools/assemblyai-token-broker.ts:120-150`
- **Approach:** Track a running byte total of `pendingBrowserMessages`. If it exceeds a threshold (e.g., 1 MB ≈ 30s of 16 kHz/16-bit audio) before upstream opens, close the browser socket with code 1011 ("upstream too slow") rather than buffering indefinitely.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** Integration test (rolls into Fix #25) that opens the proxy, blocks the upstream `ws.Server` from accepting, sends > 1 MB of audio frames, asserts the browser side receives a 1011 close.

### Fix #15 — Memoize telemetry summary
- **Source:** AUDIT.md → Performance & scalability → P-5
- **Severity:** Low
- **Files affected:** `src/captions/latency.ts:91-108, 110-134`
- **Approach:** Make `report()` a memoized accessor that recomputes only when a new event is `mark`ed since the last `report()`. Same shape for `summarizeLatencyBudget` if reused multiple times. Memoization key is the events-array length.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** Unit test asserts that two consecutive `report()` calls without intervening `mark()` return reference-equal objects.

### Fix #16 — Validate `TOKEN_BROKER_PORT` parse
- **Source:** AUDIT.md → Observability & error handling → O-7
- **Severity:** Low
- **Files affected:** `tools/assemblyai-token-broker.ts:8`
- **Approach:** Parse with `Number.parseInt`, check `Number.isInteger` and `0 < n < 65536`. Throw a friendly `Error` with the failing input value if not. (The env var name itself is renamed in Fix #33; this fix targets only the parsing logic.)
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** Manual: `ASSEMBLYAI_TOKEN_BROKER_PORT=abc npm run token-broker` exits with the friendly error message instead of a `RangeError` from `server.listen`.

### Fix #17 — Replace `validateAssemblyAiToken` regex with real key shape
- **Source:** AUDIT.md → Security & secrets handling → S-5
- **Severity:** Medium
- **Files affected:** `src/asr/AssemblyAiStreamingClient.ts:39-45`
- **Approach:** Per RESEARCH.md S-5 Option A: replace `/^sk[_-]/i` with a check that rejects 32-char hex (the actual leak shape). Apply the same fix to `validateDeepgramAccessToken` in `DeepgramStreamingClient.ts:50-56` (Deepgram tokens are JWTs; reject anything that lacks the `eyJ` prefix-shape since a raw API key wouldn't have it).
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** Unit test that asserts a 32-char hex value (no real key value committed; use a synthesized example) is rejected for AssemblyAI; a non-JWT-shaped value is rejected for Deepgram.

### Fix #18 — Reconcile manifest network whitelist (spike)
- **Source:** AUDIT.md → Security & secrets handling → S-7
- **Severity:** Low
- **Files affected:** `app.json`, `tests/integration/manifestPermissions.test.ts`
- **Approach:** Spike — research thin in this area. Determine whether Even Hub auto-allows loopback/LAN despite the whitelist. Two paths possible: (a) hardware test on G2 confirming the WebView can reach `http://lan:8787/...` despite only `https://api.deepgram.com` whitelisted; (b) consult the Even Hub SDK source/docs for whitelist enforcement semantics. Output is either a code change (add LAN broker entry) or a doc comment in `app.json` explaining the entry's true purpose.
- **Dependencies:** none
- **Effort:** S (spike, time-boxed to <2 hours)
- **Risk:** Low
- **Verification:** Spike memo (added to `docs/12-manifest-whitelist-spike.md` next phase number) documents the finding; manifest test asserts whatever the new agreed shape is.

### Fix #19 — Flip auto-smoke default to opt-in
- **Source:** AUDIT.md → Security & secrets handling → S-8
- **Severity:** Medium
- **Files affected:** `src/app/runtimeConfig.ts:24-27`, `src/app/main.ts:48-51`
- **Approach:** Per RESEARCH.md S-8 Option A: change `shouldAutoRunHardwareSmoke` to return true only when `?autoSmoke=1` is explicitly present. Default behavior (no query flag) becomes "wait for user button press." Update `hardware/readiness.ts` QR generation to include the flag.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** `tests/unit/runtimeConfig.test.ts` adds two cases: `?autoSmoke=1` returns true, missing flag returns false even when `hasEvenBridge=true`.

### Fix #20 — Add Dependabot config
- **Source:** AUDIT.md → Dependencies & tech debt → D-4
- **Severity:** Low
- **Files affected:** new `.github/dependabot.yml`
- **Approach:** Per RESEARCH.md D-1 sources: Dependabot is the right pick for a GitHub-only repo at this scale. Configure weekly `npm` updates with grouped minor/patch PRs, and `github-actions` updates so CI workflow versions stay current. No automerge — solo dev reviews PRs.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** `gh api repos/iamantonio/g2-captions/dependabot/secrets` (or the GitHub UI) confirms the config is parsed; first weekly run produces a PR within seven days.

### Fix #21 — Document Even Hub SDK pinning policy
- **Source:** AUDIT.md → Dependencies & tech debt → D-2
- **Severity:** Low
- **Files affected:** `DECISIONS.md`, `package.json`
- **Approach:** Add a `D-0007` decision to `DECISIONS.md` explicitly recording why `@evenrealities/even_hub_sdk` is pinned at `^0.0.10` (npm semver treats 0.x.x as exact) and the upgrade triage policy (manual review of any new minor). No code change. If Tony wants automatic patch updates, change to `~0.0.10` and document.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** `DECISIONS.md` contains D-0007 with status, rationale, and policy.

### Fix #22 — Parametric `VisualStatusKind` integration tests
- **Source:** AUDIT.md → Test coverage & CI/CD → T-3
- **Severity:** Medium
- **Files affected:** `src/types.ts`, `tests/integration/accessibilityFallback.test.ts`
- **Approach:** Per RESEARCH.md T-3: export a `VISUAL_STATUS_KINDS` runtime constant in `src/types.ts` (`as const`), derive the `VisualStatusKind` union from it (`typeof VISUAL_STATUS_KINDS[number]`), and add `it.each(VISUAL_STATUS_KINDS)` to the integration test asserting (a) the rendered text matches an expected substring per kind and (b) it never matches `/beep|sound|audio cue/i`. Keep the type-level exhaustiveness check as belt-and-braces.
- **Dependencies:** none
- **Effort:** S
- **Risk:** Low
- **Verification:** `npm test` reports six parameterized cases under "phone visual accessibility fallback"; deleting any kind from the constant fails type-check at the consumer site (`formatVisualStatus`'s switch).

---

## Wave 2 — Structural

**Rationale:** This wave addresses root causes that touch the broker, the CI pipeline, and the project's auth/observability backbone. Fix #25 (broker integration tests) lands first inside the wave because it is the verification mechanism for the security and observability changes that follow (Fixes #34, #35, #36, and the entire #26-#31 logger/health/handlers chain). Fix #26 (Pino logger) is the cross-cutting prerequisite for #27, #28, #29, #31. Fix #34 (bearer token) unblocks #35 (Origin defense-in-depth). Lint/format/audit (Fix #23) lands early so subsequent code in this wave runs under the lint contract. None of these changes are large enough to be Long-Term, but they are too coordinated for Wave 1.

### Fix #23 — Add ESLint flat config + Prettier + coverage + `audit-ci` to CI
- **Source:** AUDIT.md → Test coverage & CI/CD → T-4
- **Severity:** Medium
- **Files affected:** new `eslint.config.mjs`, new `.prettierrc.json`, `package.json` (devDeps + scripts), `.github/workflows/ci.yml`, `vite.config.ts` (coverage config)
- **Approach:** Per RESEARCH.md T-4 Option A: add `typescript-eslint` v8+ (flat config, `tseslint.configs.strict` + `tseslint.configs.stylistic`), Prettier with default config, Vitest v8 coverage provider with `text` + `json-summary` reporters, and `audit-ci` step (`audit-ci --moderate`). Add `npm run lint`, `npm run format`, `npm run test:coverage` scripts. Wire into CI as parallel jobs.
- **Dependencies:** none
- **Effort:** M
- **Risk:** Low (existing tests must continue to pass; some lint-cleanup churn expected)
- **Verification:** CI workflow shows four green jobs (test, build, lint, audit); `npm run test:coverage` outputs a coverage table; `npm run lint` exits 0 on the codebase.

### Fix #24 — Add pre-commit hook (husky + lint-staged)
- **Source:** AUDIT.md → Test coverage & CI/CD → T-5
- **Severity:** Low
- **Files affected:** new `.husky/pre-commit`, `package.json` (devDeps + `lint-staged` config)
- **Approach:** Add `husky` and `lint-staged` dev deps. Pre-commit runs `lint-staged` on changed files (lint + format + targeted test if practical). Add to `package.json prepare` script for fresh clones.
- **Dependencies:** Fix #23 (lint config must exist)
- **Effort:** S
- **Risk:** Low
- **Verification:** Stage a deliberately badly-formatted change, run `git commit` — hook reformats or rejects.

### Fix #25 — Add token broker integration tests (`superwstest`)
- **Source:** AUDIT.md → Test coverage & CI/CD → T-2
- **Severity:** High
- **Files affected:** new `tests/integration/tokenBroker.test.ts`, `package.json` (devDeps), possibly `tools/assemblyai-token-broker.ts` (extract a `createTokenBrokerServer({deps}): http.Server` factory function so tests can start it on an OS-assigned port without invoking the file as a script)
- **Approach:** Per RESEARCH.md T-2 Option A. Add `superwstest` as devDep. Refactor the broker to export a server-factory that takes injected upstream-WS factory + auth keys + logger. Tests start it on `port:0` in `beforeAll`, hit each route (`/healthz` once Fix #28 lands, `/deepgram/token`, `/assemblyai/token`, `/client-log`), upgrade `/deepgram/listen`, and exercise close coordination. Mock upstream Deepgram with a local `ws.Server`. Keep tests hermetic.
- **Dependencies:** none (lands first in Wave 2)
- **Effort:** M
- **Risk:** Low
- **Verification:** New test file passes; covers happy path + the four broker routes + WS proxy upgrade + close coordination + body-parse non-ASCII (rolls in Fix #10's verification) + buffer cap (Fix #14).

### Fix #26 — Adopt Pino structured logging
- **Source:** AUDIT.md → Observability & error handling → O-2
- **Severity:** Medium
- **Files affected:** new `src/observability/logger.ts` (or similar), `tools/assemblyai-token-broker.ts`, `tools/run-fixture-prototype.ts`, `tools/run-fixture-benchmark.ts`, `tools/run-hardware-readiness.ts`, `src/app/main.ts` (browser path keeps `console.info` but with structured payload to `/client-log`), `package.json` (deps)
- **Approach:** Per RESEARCH.md O-2 Option A. Add `pino` (and `pino-pretty` as devDep). Wrap in a small `getLogger(name)` factory so the WebView can use a no-op shim and the broker uses real Pino. Replace `console.log/info` calls with `logger.info({stage, ...details}, message)`. WebView side standardizes the `/client-log` payload shape to `{level, stage, details, at}`.
- **Dependencies:** none
- **Effort:** M
- **Risk:** Low (no behavior change beyond log format)
- **Verification:** Run broker, observe NDJSON output with `level`, `time`, `pid`, `msg` fields; broker tests (Fix #25) assert log lines match expected JSON shape on key events.

### Fix #27 — Bind catch errors and log with structured logger
- **Source:** AUDIT.md → Observability & error handling → O-1
- **Severity:** Medium
- **Files affected:** all sites cited in AUDIT.md O-1: `src/asr/AssemblyAiLiveSession.ts:159-161`, `src/asr/DeepgramLiveSession.ts:162-164`, `src/app/main.ts:216-218,230-232,238-240,323-326`, `src/audio/browserMicrophone.ts:36-39`, `tools/assemblyai-token-broker.ts:51-54,69-72,86-89`
- **Approach:** Per RESEARCH.md O-1: bind `error: unknown` (already enabled by `useUnknownInCatchVariables` under strict), call `logger.error({err: error}, 'context')` (Pino's `err` serializer extracts message/stack/name), then transform to the visual status. Enable typescript-eslint `use-unknown-in-catch-callback-variable` rule via Fix #23 to keep the convention enforced.
- **Dependencies:** Fix #26 (logger), Fix #23 (lint rule)
- **Effort:** M
- **Risk:** Low
- **Verification:** Trigger a known failure (e.g., bad token endpoint URL) — broker logs include the original `err.message` and stack at level `error`; visual status still surfaces.

### Fix #28 — Add `GET /healthz` endpoint
- **Source:** AUDIT.md → Observability & error handling → O-3
- **Severity:** Medium
- **Files affected:** `tools/assemblyai-token-broker.ts:23-95`, `src/hardware/readiness.ts:48-50`
- **Approach:** Per RESEARCH.md O-3 Option A: add a `GET /healthz` route returning `200 {ok:true, version}`. Update `hardware/readiness.ts` probes to `curl --max-time 5 http://lan:8787/healthz` instead of `OPTIONS`.
- **Dependencies:** Fix #26 (logger so the route logs uniformly with the rest), Fix #25 (test will be added in the existing test file)
- **Effort:** S
- **Risk:** Low
- **Verification:** New broker test asserts `GET /healthz` returns `200` with `{ok:true}`; manual `curl http://127.0.0.1:8787/healthz` works.

### Fix #29 — Add `uncaughtException` / `unhandledRejection` handlers
- **Source:** AUDIT.md → Observability & error handling → O-4
- **Severity:** Medium
- **Files affected:** `tools/assemblyai-token-broker.ts:175-177`
- **Approach:** Per RESEARCH.md O-4 Option A. Register `process.on('uncaughtException', ...)` and `process.on('unhandledRejection', ...)`. Both call `logger.fatal({err}, '...')` then invoke a `gracefulShutdown()` routine (Fix #30 implements the routine; this fix calls it). Exit with code 1 after shutdown completes or a timeout (e.g., 5s).
- **Dependencies:** Fix #26 (logger)
- **Effort:** S
- **Risk:** Low
- **Verification:** Test that throws inside an `setTimeout(() => { throw new Error(...) })` callback — broker logs `fatal` line, shuts down within 5s.

### Fix #30 — Add `SIGINT`/`SIGTERM` graceful shutdown
- **Source:** AUDIT.md → Observability & error handling → O-5
- **Severity:** Low
- **Files affected:** `tools/assemblyai-token-broker.ts:175-177`
- **Approach:** Single `gracefulShutdown(signal)` function: stop accepting new HTTP/WS connections (`server.close()`), close all active proxy `ws` pairs with code 1001 ("going away"), wait up to 5s for in-flight responses, then `process.exit(0)`. Register on `SIGINT` and `SIGTERM`. Reused by Fix #29.
- **Dependencies:** Fix #29 (same shutdown routine)
- **Effort:** S
- **Risk:** Low
- **Verification:** Manual: start broker, open a proxy WS connection from the test harness, send `SIGINT` to broker — proxy WS receives a `1001` close, broker process exits cleanly.

### Fix #31 — Validate `/client-log` payloads
- **Source:** AUDIT.md → Observability & error handling → O-6
- **Severity:** Low
- **Files affected:** `tools/assemblyai-token-broker.ts:43-55`
- **Approach:** Define a small TypeScript type for the expected log payload (`{stage: string, level: 'info'|'error'|..., details?: object, href?: string, at?: string}`). Reject payloads where `stage` is missing or non-string; truncate `details` to a max byte size (e.g., 4 KB) to bound stdout pollution. Log via Pino with the validated shape.
- **Dependencies:** Fix #26 (logger), Fix #25 (test surface)
- **Effort:** S
- **Risk:** Low
- **Verification:** Broker test: POSTing a payload without `stage` returns 400; POSTing a 1 MB `details` blob is truncated in the broker stdout to the cap.

### Fix #32 — Rate limit token endpoints
- **Source:** AUDIT.md → Observability & error handling → O-8
- **Severity:** Low
- **Files affected:** `tools/assemblyai-token-broker.ts:64-91`, `package.json` (deps)
- **Approach:** Per RESEARCH.md S-2 sources (S-2's main fix is bearer-token auth; this is the orthogonal bandwidth-cap protection). Use `rate-limiter-flexible` (single-process in-memory limiter) — e.g., 10 token mints per IP per minute. Apply to both `/deepgram/token` and `/assemblyai/token`. Return 429 + `Retry-After` header when over.
- **Dependencies:** none (orthogonal to bearer auth)
- **Effort:** S
- **Risk:** Low
- **Verification:** Broker test: rapid-fire 11 token requests within a minute — 11th returns 429 with `Retry-After`.

### Fix #33 — Rename token broker files to vendor-neutral
- **Source:** AUDIT.md → Architecture & code quality → A-4
- **Severity:** Medium
- **Files affected:** rename `tools/assemblyai-token-broker.ts` → `tools/token-broker.ts`; rename `src/asr/AssemblyAiTokenBrokerServer.ts` → `src/asr/tokenBrokerServer.ts`; update env var `ASSEMBLYAI_TOKEN_BROKER_PORT` → `TOKEN_BROKER_PORT` (read both for one minor version, log deprecation if old name is set); update `package.json` (`token-broker` script path), `README.md`, all import sites, and `tests/unit/assemblyAiTokenBrokerServer.test.ts` → `tokenBrokerServer.test.ts`.
- **Dependencies:** none (but easier to land after Fix #25 establishes broker tests so the rename is verified by passing tests)
- **Effort:** M
- **Risk:** Low (mechanical rename + import updates)
- **Verification:** `npm test && npm run build` pass; `grep -rn "AssemblyAi.*Broker" src tools tests` returns no matches in renamed scope; old env var with deprecation warning still boots the broker.

### Fix #34 — Pre-shared bearer token between WebView and broker
- **Source:** AUDIT.md → Security & secrets handling → S-2
- **Severity:** High
- **Files affected:** `tools/assemblyai-token-broker.ts:23-91,99-117` (HTTP routes + WS upgrade), `src/asr/DeepgramLiveSession.ts:120-146` (token fetch path), `src/app/runtimeConfig.ts` (broker base + auth header injection), `src/app/main.ts` (passes auth into LiveSession), `.env.example`, `vite.config.ts` (`define` to inject the token at build time), tests
- **Approach:** Per RESEARCH.md S-2 Option A. Generate a `BROKER_AUTH_TOKEN` (high-entropy random string in `.env`); broker requires `Authorization: Bearer <token>` on all routes except `/healthz`; loopback (127.0.0.1) requests are exempted to keep local dev frictionless. WebView reads the token via `import.meta.env.VITE_BROKER_AUTH_TOKEN` (Vite injects from `.env`), sends it on token fetch and on the `/deepgram/listen` upgrade as a `Sec-WebSocket-Protocol` subprotocol or via initial handshake message. Fail closed when missing.
- **Dependencies:** Fix #25 (tests verify the new auth path)
- **Effort:** M
- **Risk:** Medium (failure mode: WebView can't reach broker on hardware until built with the right token; mitigations: clear visual status, env-var validation at WebView build time)
- **Verification:** Broker integration tests cover: missing header → 401, wrong token → 401, correct token → success, loopback bypass works. Hardware smoke documents the new env var requirement.

### Fix #35 — Origin defense-in-depth alongside bearer token
- **Source:** AUDIT.md → Security & secrets handling → S-4
- **Severity:** Medium
- **Files affected:** `src/asr/AssemblyAiTokenBrokerServer.ts:15-24` (renamed in Fix #33)
- **Approach:** Per RESEARCH.md S-4 Option B. Keep the Origin allowlist as a defense-in-depth layer: still reject mismatched origins for browser callers, still allow missing-Origin for non-browser (curl, scripts) — but missing-Origin no longer grants authorization on its own; the bearer token (Fix #34) is the authorization boundary. Add a comment documenting that Origin is *not* the auth boundary.
- **Dependencies:** Fix #34 (bearer token must already gate)
- **Effort:** S
- **Risk:** Low
- **Verification:** Broker tests: bearer-token-correct + Origin-mismatch returns 403; bearer-token-correct + Origin-missing returns 200 (passes through to bearer check); bearer-token-missing + Origin-correct returns 401.

### Fix #36 — Server-side fixed parameter set in Deepgram proxy
- **Source:** AUDIT.md → Security & secrets handling → S-3
- **Severity:** High
- **Files affected:** `src/asr/DeepgramProxy.ts:3-8`, `tools/assemblyai-token-broker.ts:120-122` (renamed `tools/token-broker.ts`)
- **Approach:** Per RESEARCH.md S-3 Option A. Rebuild the upstream URL from a server-controlled `DeepgramStreamingUrlOptions` set inside the broker (use `buildDeepgramStreamingUrl` already exported by `DeepgramStreamingClient.ts`), ignoring `incoming.search`. Browser provides only audio bytes. If a future use case needs client-driven parameters, evolve to an explicit allowlist with type validation.
- **Dependencies:** Fix #25 (tests verify; confirm partials still flow correctly)
- **Effort:** S
- **Risk:** Low
- **Verification:** Broker test: client sends `?model=nova-3-medical` on the upgrade URL — upstream URL captured by the test's mock Deepgram server shows `model=nova-3` (the broker default), not the client value.

---

## Wave 3 — Long-Term

**Rationale:** Wave 3 is the architectural-shifts wave. The entry-point refactor (Fix #37) blocks meaningful tests for `main.ts` (Fix #38) and the debounce-renderer change (Fix #41); the strategy-pattern refactor (Fix #39) absorbs the duplicate parse helpers (Fix #40). These are all multi-file rewrites with non-trivial test surface; doing them in Wave 3 means they land *after* Pino logging (#26), broker integration tests (#25), and the lint baseline (#23), so they execute under modern CI infra. The `AudioWorkletNode` migration (Fix #43) is sequenced last because it's an audio-quality risk that benefits from having all observability and tests in place to detect regressions.

### Fix #37 — Refactor `main.ts` into discrete modules
- **Source:** AUDIT.md → Architecture & code quality → A-1
- **Severity:** Medium
- **Files affected:** `src/app/main.ts` (slim down to wiring), new `src/app/UIShell.ts`, new `src/app/ASRController.ts`, new `src/app/AudioController.ts`, possibly new `src/app/TelemetryReporter.ts`
- **Approach:** Per RESEARCH.md A-1 Option A. Split into modules with constructor injection. `UIShell` owns DOM and visual status; `ASRController` owns the live session lifecycle; `AudioController` owns the active source (fixture/browser-mic/G2-SDK switching); `TelemetryReporter` owns the recorder lifecycle. `main.ts` becomes a wiring file that creates instances and connects them. Module-level mutable state moves into instance fields.
- **Dependencies:** Fix #25 (broker tests pass before refactor proceeds — so any broker-side dependency-of-renderers is verified), Fix #26 (logger ready for the new modules to use)
- **Effort:** L
- **Risk:** Medium (the WebView entry has no test coverage today — the refactor must preserve the 12 visual-status states currently emitted by `main.ts`)
- **Verification:** Manual smoke: all six buttons still work; auto-smoke (when `?autoSmoke=1`) still kicks off ASR. Fix #38 then formalizes verification.

### Fix #38 — Add unit tests for refactored entry-point modules
- **Source:** AUDIT.md → Test coverage & CI/CD → T-1
- **Severity:** High
- **Files affected:** new `tests/unit/UIShell.test.ts`, `tests/unit/ASRController.test.ts`, `tests/unit/AudioController.test.ts`, possibly `tests/unit/TelemetryReporter.test.ts`, plus a thin `tests/integration/appWiring.test.ts` smoke
- **Approach:** Per RESEARCH.md T-1 Option A. happy-dom environment per-file (`// @vitest-environment happy-dom`). Each module gets unit tests with fakes for its dependencies (fake LiveSession, fake bridge, fake telemetry). The wiring smoke asserts a `connectDeepgram` button click triggers the right call shape on the fake LiveSession.
- **Dependencies:** Fix #37 (refactor must exist), Fix #23 (happy-dom test environment + coverage active)
- **Effort:** M
- **Risk:** Low
- **Verification:** Coverage report (Fix #23 has it on) shows `src/app/*.ts` now above a meaningful threshold (e.g., 70% statements). Auto-smoke kickoff path is covered (closes the loop on Fix #19).

### Fix #39 — Strategy pattern for `LiveAsrSession` (vendor adapter)
- **Source:** AUDIT.md → Architecture & code quality → A-2
- **Severity:** Medium
- **Files affected:** new `src/asr/LiveAsrSession.ts`, new `src/asr/AssemblyAiAdapter.ts`, new `src/asr/DeepgramAdapter.ts`, delete or deprecate `src/asr/AssemblyAiLiveSession.ts` and `src/asr/DeepgramLiveSession.ts`, update `src/app/ASRController.ts` (Fix #37) to compose `LiveAsrSession` with the chosen adapter, update tests
- **Approach:** Per RESEARCH.md A-2 Option A. Introduce `interface VendorAdapter { buildUrl(opts), buildTerminateMessage(), parseTokenResponse(payload), parseTurnEvent(payload), websocketProtocols?(token) }`. Single `LiveAsrSession` class owns the WebSocket lifecycle (connect / streamPcmChunks / sendPcmChunk / terminate / fetchTemporaryToken / handleMessage / markTelemetry). Adapters implement only the vendor-specific bits. New adapter (e.g., Speechmatics, per `DECISIONS.md` D-0005) becomes a single new file.
- **Dependencies:** Fix #25 (broker tests — verifies the WebSocket path still behaves correctly)
- **Effort:** L
- **Risk:** Medium (rewrite of the most security-sensitive client; mitigations: keep both old and new sessions side-by-side in the first PR, swap usage in `ASRController` last)
- **Verification:** Existing tests for AssemblyAi/Deepgram LiveSessions migrate to the strategy form. New unit test asserts adding a new adapter only requires implementing the adapter interface. End-to-end: live AssemblyAI smoke and live Deepgram smoke both still pass.

### Fix #40 — Extract shared ASR parse helpers
- **Source:** AUDIT.md → Architecture & code quality → A-3
- **Severity:** Medium
- **Files affected:** new `src/asr/parseHelpers.ts`, modify `src/asr/AssemblyAiStreamingClient.ts:104-114` and `src/asr/DeepgramStreamingClient.ts:125-137`
- **Approach:** Per RESEARCH.md A-3 Option A. Extract `optionalNumber`, `optionalString`/`optionalSpeaker` (consolidated), `secondsToMs`, `findFirstFiniteWord`, `findLastFiniteWord` into a shared module. Both vendor mappers consume them. Land alongside Fix #39 since the strategy adapters will both use the helpers.
- **Dependencies:** Fix #39 (adapters consume the helpers)
- **Effort:** S
- **Risk:** Low
- **Verification:** Existing parser tests still pass; `grep -c "optionalNumber" src/asr/*.ts` returns 1 (the shared module).

### Fix #41 — Debounce partials / immediate finals (BLE rate cap)
- **Source:** AUDIT.md → Performance & scalability → P-1
- **Severity:** Medium
- **Files affected:** `src/app/UIShell.ts` (Fix #37), `src/app/ASRController.ts` (Fix #37), possibly a new helper `src/app/renderScheduler.ts`
- **Approach:** Per RESEARCH.md P-1 Option B. In the refactored `ASRController.onTranscript`, route partials through a 150ms trailing debounce; finals bypass the debounce and render immediately. State updates (`state.applyAsrEvent`) remain immediate; only the `renderShell` call is debounced. Project's 800ms latency budget is unaffected (150ms < 800ms).
- **Dependencies:** Fix #37 (`UIShell` and `ASRController` exist as modules)
- **Effort:** M
- **Risk:** Medium (timing-sensitive; can introduce visible lag if mis-tuned; mitigations: unit test for "final immediate", "partials collapse to one render per debounce window")
- **Verification:** Unit test of the renderScheduler asserts partials within 150ms collapse into one render call; finals fire synchronously. Manual: hardware smoke shows visible captions still update smoothly without flicker.

### Fix #42 — Cache `CaptionState.segments()` snapshot
- **Source:** AUDIT.md → Performance & scalability → P-2
- **Severity:** Low
- **Files affected:** `src/captions/CaptionState.ts:29-31`, `src/captions/formatter.ts:74`
- **Approach:** Memoize the sorted segment list inside `CaptionState`; invalidate when `applyAsrEvent` or `clear` mutates state. Have `formatter.selectRecentCaptionLines` accept the already-sorted list and skip its second sort. May be moot if Fix #41 reduces render frequency enough that perf no longer matters; revisit after #41 lands and measure before implementing #42.
- **Dependencies:** Fix #41 (re-evaluate need post-debounce)
- **Effort:** S
- **Risk:** Low
- **Verification:** Microbenchmark: 1000 consecutive `state.segments()` calls without mutation are >10× faster than baseline; existing formatter tests still pass.

### Fix #43 — Migrate browser microphone to `AudioWorkletNode`
- **Source:** AUDIT.md → Architecture & code quality → A-8
- **Severity:** Low
- **Files affected:** `src/audio/browserMicrophone.ts:56-78` (rewrite), new `src/audio/audio-worklet-processor.ts` (the AudioWorklet module loaded at runtime), Vite config (worklet asset handling), tests
- **Approach:** Replace `ScriptProcessorNode` with `AudioWorkletNode`. Move PCM downsampling into an `AudioWorkletProcessor` running on the audio thread. The worklet posts PCM chunks back via `port.postMessage`. Vite needs to emit the worklet as a separate ES module asset.
- **Dependencies:** none (independent of all other fixes), but benefits from Fix #23's lint contract and Fix #26's logger to detect regressions
- **Effort:** L
- **Risk:** Medium (audio path change; off-main-thread processing has different timing characteristics; mitigations: keep ScriptProcessor branch with a feature flag for one minor version to allow A/B comparison)
- **Verification:** `tests/unit/browserMicrophone.test.ts` updated to mock `AudioWorkletNode`; manual smoke confirms transcribed text from browser-mic path matches the fixture-mode baseline; Chrome console shows no `ScriptProcessorNode is deprecated` warning.
