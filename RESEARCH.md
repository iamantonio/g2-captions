# Research — g2-captions

## Scope

- **Findings researched:** 4 High + 17 Medium = 21 (all Critical + High + Medium from `AUDIT.md`)
- **Sources prioritized:** vendor docs (Deepgram, AssemblyAI, Vitest, Node.js) > RFCs / OWASP > maintainers' repos & docs > engineering blogs > Stack Overflow (avoided unless flagged)

---

## S-2 — Token broker mints streaming tokens without per-request authorization — HIGH

**Finding restated:** `POST /deepgram/token` and `POST /assemblyai/token` will mint a vendor streaming token to anyone reaching the broker port; the only check is an Origin header that's also bypassed when absent.

### Candidate approaches

**Option A — Pre-shared bearer token between WebView and broker**
- Pros: Simple. RFC 6750 standard. Both sides already share the local `.env` boundary, so a `BROKER_AUTH_TOKEN` env var fits cleanly. Independent of CORS.
- Cons: Token has to be injected into the WebView at build time or fetched via a one-time bootstrap; rotating it requires a rebuild.
- Fit: Excellent. Matches the project's "broker is the trust boundary" model and adds no new dependency.

**Option B — Loopback-only bind plus SSH-tunnel for hardware smoke**
- Pros: Removes the LAN attack surface entirely; loopback is implicitly trusted on the developer machine.
- Cons: Hardware smoke from the G2 (a separate device) requires an SSH/Tailscale tunnel — meaningful operator friction. `hardware/readiness.ts:43` currently uses `HOST=0.0.0.0`, which would have to go away.
- Fit: Good for the threat model but bad for the documented hardware-smoke workflow.

**Option C — mTLS between WebView and broker**
- Pros: Strong cryptographic identity; resists token theft.
- Cons: Significant complexity (cert generation, trust roots inside the WebView, manifest origin compatibility unclear). Overkill for a single-developer prototype.
- Fit: Poor — the cost-to-benefit is wrong for a Phase-2 prototype.

### Recommendation

**Option A.** Add a `BROKER_AUTH_TOKEN` env var (any high-entropy random string), require it on every HTTP route and the WS upgrade as `Authorization: Bearer <token>`, fail closed when missing. The vendor token issuance keeps its short TTL (60s); the bearer token is the per-call authorization for the broker itself. This is the same pattern Deepgram and AssemblyAI document for their own token-grant endpoints (`Authorization: Token <api_key>` / `Authorization: <api_key>`), just one hop closer to the client. Loopback can be exempted to keep the local dev loop friction-free.

### Sources

- [Deepgram — Token-Based Authentication (guides)](https://developers.deepgram.com/guides/fundamentals/token-based-authentication) — official vendor doc; describes how token endpoints are protected and why the vendor recommends ephemeral tokens for clients.
- [AssemblyAI — Authenticate with a temporary token](https://www.assemblyai.com/docs/streaming/authenticate-with-a-temporary-token) — official vendor doc; same pattern as Deepgram, server mints, client receives.
- [RFC 6750 — The OAuth 2.0 Authorization Framework: Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750) — IETF standard for the Bearer scheme.

---

## S-3 — Deepgram WebSocket proxy forwards arbitrary client query parameters upstream — HIGH

**Finding restated:** `buildDeepgramProxyUpstreamUrl` does `upstream.search = incoming.search`, copying every browser-supplied query parameter onto the upstream URL with no allowlist. A caller controls model selection and feature flags on the operator's bill.

### Candidate approaches

**Option A — Server-side fixed parameter set**
- Pros: Broker is the sole authority on which model + features are billed. Client provides only the audio bytes. Strongest defense; blast radius is zero.
- Cons: Loses flexibility — to change a Deepgram parameter you redeploy the broker (low cost since the broker is a local dev process).
- Fit: Excellent. Matches the project's existing approach for *why* the broker exists at all (server-side trust boundary).

**Option B — Per-key allowlist with type validation**
- Pros: Lets the WebView legitimately pick e.g. language while still blocking dangerous params (`model=nova-3-medical`, `extra=...`, `tag=...`, `mip_opt_out`).
- Cons: Risk drifts: every Deepgram parameter addition needs a triage decision. The Deepgram listen API has 30+ parameters per the AsyncAPI spec, and at least three (`model`, `redact`, `extra`) have direct billing or PII implications.
- Fit: Acceptable but adds maintenance debt as Deepgram's API evolves.

**Option C — Deny-list for known-dangerous params, pass-through otherwise**
- Pros: Minimal initial code change.
- Cons: Default-allow is the wrong posture; new Deepgram parameters become silent risks until someone notices. Inverse of the secure default.
- Fit: Poor — fails the "fail closed" test.

### Recommendation

**Option A** for the proxy path: hard-code the Deepgram URL parameter set in `DeepgramProxy.ts` (build it from `DeepgramStreamingUrlOptions` set by the broker, not from the incoming request), and ignore `incoming.search`. The client does not need parameter control because today the only WebView call site is the project's own `DeepgramLiveSession`, which passes the same fixed config every time. If parameter flexibility is later needed, evolve to Option B with an explicit allowlist *and* type validation (e.g. `model` must be in `{nova-3, nova-3-general}`, never `nova-3-medical`).

### Sources

- [Deepgram — Live Audio API reference (listen-streaming)](https://developers.deepgram.com/reference/speech-to-text/listen-streaming) — official AsyncAPI spec listing all 30+ parameters; authoritative on what an attacker could set.
- [Deepgram blog — Browser Live Transcription, Protecting Your API Key](https://deepgram.com/learn/protecting-api-key) — vendor-published guidance to keep parameter selection server-side.

---

## T-1 — `src/app/main.ts` (largest source file) has zero tests — HIGH

**Finding restated:** The 329-LOC WebView entry point — DOM rendering, button wiring, ASR session lifecycle, telemetry recording, auto-smoke kickoff — has no test references in `tests/`.

### Candidate approaches

**Option A — Refactor entry into testable modules, then test with happy-dom**
- Pros: Decomposes A-1 simultaneously. Pure modules unit-test trivially. The entry point becomes a thin glue layer that's just a wiring smoke test.
- Cons: Requires refactor before tests. Order of operations matters.
- Fit: Strong. happy-dom is 2-4× faster than jsdom and Vitest supports both natively per-file via `// @vitest-environment happy-dom`.

**Option B — Real-browser tests via `@vitest/browser` (Playwright/WebDriver)**
- Pros: Catches DOM-real bugs (event listeners, layout, the actual `<pre>` rendering on G2).
- Cons: New runtime dep; CI complexity (browser binary cache); slower; overkill for a logic-heavy entry point.
- Fit: Worth considering only after Option A; not a substitute.

**Option C — jsdom + manual mocks for Even Hub bridge**
- Pros: Tests the current monolithic `main.ts` with zero refactor.
- Cons: jsdom is the slow choice; module-level mutable state in `main.ts` (line 16-22) makes per-test isolation painful — every test would need a `vi.resetModules()` dance.
- Fit: Mediocre. Buys coverage but doesn't pay down the architectural debt.

### Recommendation

**Option A.** Couple this to A-1: extract `ASRController`, `AudioController`, `LensRenderer`, and `UIShell` modules with explicit `inject`-style constructors; unit-test each with happy-dom; then add one thin "wires everything correctly" smoke test for the entry. happy-dom is the right environment per Vitest's official docs and benchmarks. Test the auto-smoke kickoff path explicitly (closes the loop on S-8).

### Sources

- [Vitest — Test Environment](https://vitest.dev/guide/environment) — official; documents both jsdom and happy-dom and the per-file environment override.
- [happy-dom — Setup as Test Environment (wiki)](https://github.com/capricorn86/happy-dom/wiki/Setup-as-Test-Environment) — maintainer-authoritative setup guide.

---

## T-2 — Token broker HTTP/WS routes have no integration tests — HIGH

**Finding restated:** Helper modules for the broker are tested, but the actual `createServer` route table, `/client-log` body parser, `/deepgram/listen` upgrade path, and WS proxy close-coordination are exercised only by manual hardware smoke.

### Candidate approaches

**Option A — `superwstest` (HTTP + WS in one supertest-compatible API)**
- Pros: Designed for exactly this case (HTTP + WS on one Node server). API mirrors supertest. Active project. Forces you to start the server in `beforeEach(port:0)` / `afterEach(server.close)`, which matches the recommended pattern.
- Cons: Adds a dev dep. The project doesn't currently use supertest, so this is *the* dep, not an *additional* dep.
- Fit: Best fit. The broker's WS proxy is the most security-sensitive surface and is exactly what `superwstest` is built for.

**Option B — supertest for HTTP + raw `ws` client for WS**
- Pros: supertest is the de-facto Node HTTP test library; `ws` is already a dep. No new dep needed.
- Cons: WS testing requires hand-rolled event-driven assertions; "websockets are not simple when it comes to writing tests because they are event-driven and have no promise-based API" per the linked Medium article.
- Fit: Workable but uglier WS tests.

**Option C — Lift route handlers into pure functions and unit-test only**
- Pros: Fastest tests, no port management.
- Cons: Skips the actual upgrade-handshake and close-coordination logic — exactly the bugs T-2 worries about. Misses the integration-of-routes which is the audit's stated concern.
- Fit: Doesn't address the finding.

### Recommendation

**Option A — `superwstest`.** Start the broker on `port:0` in `beforeAll` (the OS picks a free port), exercise each HTTP route, then upgrade and exchange messages on `/deepgram/listen`. Mock the upstream Deepgram WS with another local `ws.Server` so tests stay hermetic. This is the canonical Node integration-testing pattern for HTTP+WS surfaces.

### Sources

- [`superwstest` (npm)](https://www.npmjs.com/package/superwstest) — maintainer page; explicitly designed for "supertest with WebSocket capabilities" — the exact shape needed.
- [`supertest` (npm)](https://www.npmjs.com/package/supertest) — the underlying HTTP test library; widely accepted Node default.
- [Integration Testing WebSocket Server in Node.JS (Medium)](https://medium.com/@basavarajkn/integration-testing-websocket-server-in-node-js-2997d107414c) — engineering write-up of the `port:0 + before/afterEach` pattern; corroborating, not primary.

---

## S-4 — Origin allowlist is bypassed by missing Origin header — MEDIUM

**Finding restated:** `if (!origin) return true` lets non-browser callers (curl, scripts) through with no Origin set at all, and Origin is trivially settable by a non-browser client anyway.

### Candidate approaches

**Option A — Reject when Origin is missing AND request did not come over loopback**
- Pros: Cheap stop-gap; closes the bypass without architecting auth.
- Cons: Treats Origin as authentication, which OWASP and PortSwigger explicitly call out as wrong.
- Fit: Mediocre — a half-fix that the next reviewer will ask about.

**Option B — Combine Origin check with bearer token (S-2 fix)**
- Pros: Origin becomes a defense-in-depth layer for browser callers; the bearer token is the actual authorization. Fail-closed by design.
- Cons: Requires S-2 to land first.
- Fit: Strongest. Aligns Origin handling with OWASP guidance: Origin is *not* an auth boundary, so don't pretend it is.

**Option C — Use `Sec-Fetch-Site: same-origin` as the gate**
- Pros: Browsers send it unforgeably from secure contexts; `same-origin` distinguishes from cross-site.
- Cons: Not sent by non-browser clients (so still need bearer for those); not universally available across older WebView runtimes; doesn't help on the WebSocket upgrade path.
- Fit: Useful only as a belt-and-braces signal alongside Option B.

### Recommendation

**Option B.** Origin is an integrity hint, never an authorization. Once the bearer token from S-2 is in place, the Origin check becomes a low-cost defense-in-depth layer for browser callers — keep it, but stop relying on it. OWASP CSRF cheatsheet calls out exactly this anti-pattern.

### Sources

- [OWASP — Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) — OWASP-curated authoritative guidance on what Origin can and cannot do.
- [PortSwigger — CORS](https://portswigger.net/web-security/cors) — vendor-neutral security education from a major security-tooling firm; specifically warns against using dynamic Origin reflection as auth.

---

## S-5 — `validateAssemblyAiToken` regex doesn't match real key shape — MEDIUM

**Finding restated:** The `/^sk[_-]/i` check in `AssemblyAiStreamingClient.ts:39-45` is an OpenAI-style key shape; AssemblyAI keys are 32-char hex (and Deepgram's are similar). The validator never fires for an actual leaked key.

### Candidate approaches

**Option A — Length + character-class check matching the real key shape**
- Pros: Catches the actual leak shape: `^[a-f0-9]{32,}$` for AssemblyAI / Deepgram. Rejects anything that "looks like" a raw API key.
- Cons: API-key shapes can change; this becomes a future tripwire (tolerable since the failure mode is loud).
- Fit: Good. Matches the regexes used by GitGuardian and other secret-scanners.

**Option B — Drop the validator, rely on broker exchange**
- Pros: The broker swap is the actual security boundary — the validator is belt-and-braces.
- Cons: Loses a cheap failsafe. Project's stated non-negotiable ("API keys must never be embedded in the WebView") is more credible with a runtime check than without.
- Fit: Acceptable but lossy.

**Option C — Replace with positive validation of the *expected token* shape**
- Pros: Asserts what should be true (temporary token format) rather than what shouldn't (raw key shape).
- Cons: Vendor token shapes are JWT for Deepgram (`eyJ...`) and an opaque string for AssemblyAI — they differ, so the check has to fork by vendor.
- Fit: Stronger conceptually but more code.

### Recommendation

**Option A** as the immediate fix; **Option C** as the durable design. For Phase 3, replace the regex with a positive-shape check per vendor (Deepgram tokens start `eyJ` because they're JWTs; AssemblyAI temporary tokens have a known prefix or length distinct from raw API keys). Pair this with a unit test of the negative case (real-shaped API keys are rejected).

### Sources

- [GitGuardian — Deepgram API Key detector](https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/detectors/specifics/deepgram_api_key) — secret-scanning vendor; documents the exact key shape used by GitGuardian's leak detection (most authoritative third-party source for the shape).
- [Deepgram — Authenticating](https://developers.deepgram.com/guides/fundamentals/authenticating) — vendor-confirmed: `Authorization: Token <api_key>` for raw keys, `Authorization: Bearer <jwt>` for temporary tokens (so the token format differs from the key format).

---

## S-6 — `.env.example` omits `DEEPGRAM_API_KEY` — MEDIUM

**Finding restated:** `.env.example` documents only `ASSEMBLYAI_API_KEY` even though the broker reads `DEEPGRAM_API_KEY` and `main.ts` wires Deepgram as the default vendor.

### Candidate approaches

**Option A — Add `DEEPGRAM_API_KEY=your_deepgram_api_key_here` to `.env.example`**
- Pros: Trivial. Matches 12-factor app's "config in environment" principle, where every required env var is documented in a sample file.
- Cons: None.
- Fit: Excellent.

**Option B — Add a config-validation step on broker startup**
- Pros: Fails loudly with a clear message instead of a stack trace inside `readDeepgramApiKeyFromEnv`. Pairs with the 12-factor advice on validating config.
- Cons: A second change on top of A.
- Fit: Belt-and-braces; combine with A.

**Option C — Treat `.env.example` as canonical, generate broker startup checks from it**
- Pros: Single source of truth.
- Cons: Tooling complexity; not warranted at this scale.
- Fit: Overkill.

### Recommendation

**Options A + B.** Add the missing key to `.env.example` and a startup check (`assert all required env vars are present, with named errors`) so the broker fails fast with a friendly message. This matches the 12-factor doctrine: environment vars are the configuration boundary; the sample file is documentation of that boundary.

### Sources

- [12-Factor App — III. Config](https://12factor.net/config) — the canonical doctrine on environment-variable configuration; cited by every modern config-handling guide.
- [Marmelab — Twelve-Factor Applications: How Do You Validate Your Configuration?](https://marmelab.com/blog/2018/12/05/twelve-factor-applications-how-do-you-validate-your-configuration.html) — engineering write-up on adding startup validation; secondary but useful pattern reference.

---

## S-8 — Hardware smoke auto-runs live ASR on app boot when bridge is detected — MEDIUM

**Finding restated:** `shouldAutoRunHardwareSmoke` returns true by default whenever the Even Hub bridge is present, which silently mints a Deepgram token and streams audio without an explicit user action — contrary to `DECISIONS.md` D-0006 / G-0003.

### Candidate approaches

**Option A — Default-off, explicit opt-in via `?autoSmoke=1`**
- Pros: Inverts the current default to the safe one. Aligns with the documented "explicit user action before live cloud audio" rule. URL-flag preserves the convenience for the developer who actually wants the smoke.
- Cons: Hardware smoke now requires one extra QR step (`evenhub qr --url "...?autoSmoke=1"`).
- Fit: Strongest match to the D-0006 / G-0003 non-negotiables.

**Option B — Require an in-WebView confirm-button before the smoke fires**
- Pros: User cannot miss the consent. Even safer than A.
- Cons: Slows the smoke loop with an unnecessary click in development.
- Fit: Higher friction than warranted; A is enough.

**Option C — Gate with a separate env-derived signal (e.g., `?hardwareSmoke=<token>`)**
- Pros: Only an operator with the token can trigger; protects against accidental smoke from a tab left open.
- Cons: New surface to manage, extra friction, low marginal benefit over A.
- Fit: Overkill.

### Recommendation

**Option A.** Flip the default. The url-flag-as-feature-flag pattern is established for runtime config in browser apps; `runtimeConfig.ts` already uses `?autoSmoke=0` as the *off* signal — the recommendation is just to invert which value is the default. Add a unit test that asserts the bridge-present path *does not* auto-run unless `autoSmoke=1`.

### Sources

- [12-Factor App — III. Config](https://12factor.net/config) — establishes that environment-derived signals (URL params here, env vars on the broker) drive feature decisions.
- (Project source) — `DECISIONS.md` D-0006 / G-0003; primary internal source for the non-negotiable, cited as the constraint this finding violates.

---

## A-1 — `src/app/main.ts` mixes too many concerns in one 329-line file — MEDIUM

**Finding restated:** One module owns bridge bootstrap, DOM rendering, button wiring, ASR session lifecycle, audio source orchestration, telemetry, structured client logging, and visual-status broadcasting.

### Candidate approaches

**Option A — Split into pure TS modules with explicit constructor injection**
- Pros: Each module unit-testable with happy-dom. State is held inside class instances, not module globals, so per-test isolation is trivial. No new dep. Idiomatic for the project's existing class-style code (`DeepgramLiveSession`, `G2LensDisplay`).
- Cons: One-time refactor cost.
- Fit: Best — uniform with the rest of the codebase.

**Option B — Adopt a lightweight reactive state library (Zustand-like, e.g. nanostores)**
- Pros: Centralizes mutable state; decouples renders from event sources.
- Cons: New dep; new mental model. The project's vanilla-DOM style doesn't reach for libraries today.
- Fit: Mediocre.

**Option C — Adopt a small UI framework (Lit, Solid, Preact)**
- Pros: Components naturally separate concerns; good ecosystem for testing.
- Cons: Significant new dep; bundle-size impact for an Even Hub WebView; rewrites the rendering layer.
- Fit: Out of proportion to the prototype's needs.

### Recommendation

**Option A.** Three or four modules with `inject`-style constructors: `ASRController` (owns the live session lifecycle), `AudioController` (owns the active source), `UIShell` (owns DOM updates), and a top-level `App` that wires them. State that today lives at module scope (`session`, `g2Display`, `liveAudioSource`, `lastFrameText`, `currentVisualStatus`, `telemetry`) becomes instance state on the relevant module. This unblocks T-1.

### Sources

- [TypeScript Handbook — Modules](https://www.typescriptlang.org/docs/handbook/2/modules.html) — official guidance on the project's existing module style.
- *Refactoring* by Martin Fowler — "Extract Class" is the canonical refactor for this exact symptom (one class doing what should be many). Treated here as established practice; no single URL is the canonical reference.

---

## A-2 — `AssemblyAiLiveSession` and `DeepgramLiveSession` ~80% duplicated — MEDIUM

**Finding restated:** Two classes share `connect`, `streamPcmChunks`, `sendPcmChunk`, `terminate`, `markTelemetry`, `fetchTemporaryToken`, and the constructor-injection pattern; they diverge only on URL builder, terminate-message builder, response-payload key, and one extra subprotocol arg.

### Candidate approaches

**Option A — Strategy pattern: one `LiveAsrSession` class + injectable `VendorAdapter`**
- Pros: One bug fix lands once. Adding the planned third vendor (Speechmatics, per `DECISIONS.md` D-0005) is just a new adapter, not a new class. Adapter is a small interface (~5 methods).
- Cons: Slight indirection cost.
- Fit: Best — maps directly onto the four real divergences.

**Option B — Abstract base class with vendor-specific subclasses**
- Pros: Familiar OO pattern. Compile-time enforcement of override surface.
- Cons: Inheritance is more rigid; future vendor with a meaningfully different lifecycle (e.g., REST-based Speechmatics auth) doesn't fit cleanly.
- Fit: Acceptable; weaker than A.

**Option C — Plain functions: `connect(config)`, `streamPcmChunks(socket, chunks)`, etc.**
- Pros: Simplest possible; no class hierarchy.
- Cons: Loses the encapsulated socket lifecycle. Caller has to manage `socket` state; defeats the abstraction.
- Fit: Poor for a stateful WebSocket client.

### Recommendation

**Option A — Strategy pattern.** Define `interface VendorAdapter { buildUrl(opts), buildTerminateMessage(), parseTokenResponse(payload), parseTurnEvent(payload), websocketProtocols?(token) }`. The single `LiveAsrSession` class composes the adapter and keeps the shared socket lifecycle. This matches the documented plan to onboard a third vendor without further duplication.

### Sources

- [TypeScript Handbook — Interfaces & object types](https://www.typescriptlang.org/docs/handbook/2/objects.html) — official patterns for adapter-style interfaces.
- *Design Patterns* (Gang of Four) — "Strategy" pattern is the canonical solution for this duplication shape; treated as established practice.

---

## A-3 — `AssemblyAiStreamingClient` and `DeepgramStreamingClient` duplicate mapping helpers — MEDIUM

**Finding restated:** Both files re-declare `optionalNumber`, an `optionalString` variant, a number-coercion helper, and "find first/last word with finite timing" logic.

### Candidate approaches

**Option A — Plain shared utility module**
- Pros: Zero deps. Each helper is ~5 LOC. No abstraction tax.
- Cons: None at this scale.
- Fit: Best.

**Option B — Adopt a parsing/validation library (Zod, Valibot)**
- Pros: Schema-first parsing for both vendor event shapes; replaces the ad-hoc `optionalNumber`/`optionalString` style with declarative schemas.
- Cons: New dep, more code than the helpers it replaces, performance cost for high-frequency parsing.
- Fit: Overkill for handful of helpers, but worth considering if the broker grows.

**Option C — Move helpers into a vendor-agnostic namespace inside an existing module**
- Pros: No new file.
- Cons: Cross-cutting concerns belong in their own module, not stuffed into a vendor file.
- Fit: Mediocre.

### Recommendation

**Option A.** Create `src/asr/_parseHelpers.ts` (or similar) for `optionalNumber`, `optionalString`, `secondsToMs`, `findFirstFiniteWord`, `findLastFiniteWord`. Land this alongside A-2 since the strategy adapters will both consume it.

### Sources

- [TypeScript Handbook — Modules](https://www.typescriptlang.org/docs/handbook/2/modules.html) — project's existing module convention.
- *The Pragmatic Programmer* — DRY (Don't Repeat Yourself) is the canonical principle. Treated as established practice.

---

## A-4 — Token broker filename/module name still say "AssemblyAi" but serve both vendors — MEDIUM

**Finding restated:** `tools/assemblyai-token-broker.ts`, `src/asr/AssemblyAiTokenBrokerServer.ts`, and the env var `ASSEMBLYAI_TOKEN_BROKER_PORT` all carry an AssemblyAI-only history, but the broker now serves both vendors and Deepgram is default.

### Candidate approaches

**Option A — Rename to vendor-neutral names with backward-compat alias**
- Pros: Clear intent; new contributors find the broker. Backward-compat env-var alias (`TOKEN_BROKER_PORT` plus a deprecation warning if `ASSEMBLYAI_TOKEN_BROKER_PORT` is still set) avoids breaking local `.env` files.
- Cons: Touches a few callsites.
- Fit: Best.

**Option B — Split into two per-vendor brokers (separate processes)**
- Pros: Isolates blast radius; easier per-vendor reasoning.
- Cons: Doubles operator complexity (two `npm run` commands, two ports). Single broker is documented as intentional in `CLAUDE.md`.
- Fit: Goes against the project's documented architecture.

**Option C — Leave names, add a doc comment explaining**
- Pros: Zero change.
- Cons: Doesn't fix the audit finding.
- Fit: No.

### Recommendation

**Option A.** Renames: `tools/assemblyai-token-broker.ts` → `tools/token-broker.ts`; `src/asr/AssemblyAiTokenBrokerServer.ts` → `src/asr/tokenBrokerServer.ts`; env var `ASSEMBLYAI_TOKEN_BROKER_PORT` → `TOKEN_BROKER_PORT` (with the old var read as a fallback for one minor version with a deprecation warning). Naming matches the documented single-broker architecture.

### Sources

- (Project source) — `CLAUDE.md` documents the single-broker design as intentional. Internal authoritative source.
- [TypeScript Handbook — Modules](https://www.typescriptlang.org/docs/handbook/2/modules.html) — naming conventions are part of the standard module guidance.

---

## A-6 — `CaptionState` segment ID collides on simultaneous speakers — MEDIUM

**Finding restated:** Segment ID is `${event.startMs}` only — two `RawAsrEvent`s with the same `startMs` but different `speaker` overwrite each other; the map is ironically named `byStartSpeaker`.

### Candidate approaches

**Option A — Composite key `${event.speaker}:${event.startMs}`**
- Pros: Matches the map's existing intent. Two-element composite is enough because the audit's collision case is exactly speaker-difference at the same start time.
- Cons: Speaker label `?` (placeholder) collapses unknown speakers into one bucket — but that's the correct semantic for "we don't know who spoke."
- Fit: Best.

**Option B — Composite key including `vendor` + `speaker` + `startMs`**
- Pros: Defensive against vendor-mixing edge cases.
- Cons: The project always runs one vendor at a time per session; vendor in the key is purely speculative.
- Fit: Speculative defense.

**Option C — Per-event UUID/`crypto.randomUUID()`**
- Pros: Trivially unique.
- Cons: Loses the *intent* of the map — which is to coalesce partials into a single segment as more text arrives. UUID per event creates one segment per partial, breaking the partial→final coalescing.
- Fit: Wrong abstraction.

### Recommendation

**Option A.** Use `${event.speaker?.trim() || '?'}:${event.startMs}` as the key (matching the trimming already done on line 7). This preserves the partial→final coalescing semantics and addresses the collision exactly. Add a unit test for two simultaneous-`startMs` events with different speakers.

### Sources

- [MDN — Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) — official Map semantics; composite-string keys are the standard pattern.

---

## P-1 — Every ASR partial triggers a full DOM + lens re-render with no throttling — MEDIUM

**Finding restated:** Every Deepgram partial (50-100ms cadence) calls `renderShell`, which rebuilds all six buttons, replaces `app.innerHTML`, sorts segments, and writes to the BLE-backed lens via Even Hub SDK.

### Candidate approaches

**Option A — `requestAnimationFrame` batching: collect events, render at most ~60fps**
- Pros: Browser-aligned; one render per repaint regardless of input rate. Standard pattern for high-frequency streaming → DOM.
- Cons: Doesn't help the BLE-write bandwidth problem (BLE is a separate channel that doesn't follow rAF).
- Fit: Right tool for the DOM half, wrong tool for the BLE half.

**Option B — Trailing debounce for partials, immediate render for finals**
- Pros: Caps both DOM and BLE write rates. Partials at 50-100ms cadence collapse into ~1 render per debounce window (e.g., 150ms); finals are never delayed. Latency-budget impact is bounded by the debounce interval.
- Cons: One more knob (debounce ms) to tune.
- Fit: Best for the dual-target rendering (DOM + BLE).

**Option C — rAF batching for DOM + separate rate-limit for BLE writes**
- Pros: Optimizes each channel independently.
- Cons: Two systems to keep in sync.
- Fit: Acceptable but more complex than B.

### Recommendation

**Option B — hybrid debounce.** Trailing debounce (~150ms) for `partial` events; immediate render for `final` events. Project's stated latency budget is `<=800ms end-to-end` (`DECISIONS.md` D-0002), so 150ms of partial-batching is well inside the budget. Also separates the `state.applyAsrEvent(event)` (which should be immediate) from the `renderShell` call (which should be debounced) — fixing the issue where the DOM teardown happens unnecessarily often.

### Sources

- [MDN — `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame) — official; documents the rAF batching pattern.
- [SitePoint — Streaming Backends & React: Controlling Re-render Chaos in High-Frequency Data](https://www.sitepoint.com/streaming-backends-react-controlling-re-render-chaos/) — engineering write-up of the rAF + debounce pattern for streaming-data UIs; secondary but topical.

---

## T-3 — Visual-fallback test covers 1 of 6 `VisualStatusKind` values — MEDIUM

**Finding restated:** Only `g2-disconnected` is asserted; the other five — `mic-blocked`, `network-slow`, `g2-mic-lost`, `asr-lost`, `vocab-loaded` — have no integration test. The deaf-first non-negotiable is enforced for one of six cases.

### Candidate approaches

**Option A — Parametric test (`it.each`) over all six kinds**
- Pros: Adding a new kind without adding a test is impossible if the test-kinds list comes from the type. Vitest's `it.each` is purpose-built.
- Cons: Need a way to keep the parameter list in sync with the type — usually a runtime constant exported alongside the union.
- Fit: Best.

**Option B — Snapshot test of `formatVisualStatus`**
- Pros: One-liner.
- Cons: Snapshots drift silently; doesn't enforce the "no sound-only language" assertion at the type level.
- Fit: Insufficient for the stated invariant.

**Option C — Type-level exhaustiveness check (no runtime test)**
- Pros: Compile-time safety.
- Cons: Doesn't actually verify the visual-only output, just that all cases are *handled* somehow. Doesn't catch a regression that swaps one visual error for another with sound-prompt language.
- Fit: Belt-and-braces alongside Option A; not sufficient alone.

### Recommendation

**Option A + Option C.** Export a runtime `VISUAL_STATUS_KINDS` constant in `src/types.ts` (a `Readonly<VisualStatusKind[]>` that the type union derives from via `typeof VISUAL_STATUS_KINDS[number]`). The integration test parameterizes over that constant and asserts (a) text contains expected substring per kind and (b) text matches no sound-prompt regex. Adding a new kind to the constant is the only way to extend the union — which forces a test.

### Sources

- [Vitest — `test.each`](https://vitest.dev/api/#test-each) — official API for parameterized tests.
- [TypeScript Handbook — Narrowing & exhaustiveness](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking) — official guidance on the `never`-fallback exhaustiveness pattern.

---

## T-4 — CI runs no linter, formatter, `npm audit`, or coverage report — MEDIUM

**Finding restated:** CI is exactly `npm ci && npm test && npm run build`; no ESLint config exists, no Prettier, no `npm audit` step, no `vitest --coverage`.

### Candidate approaches

**Option A — typescript-eslint flat config + Prettier + Vitest v8 coverage + `audit-ci`**
- Pros: Full canonical Node/TS toolchain. typescript-eslint v8+ is required for ESLint 10 (Feb 2026 release made flat config mandatory). Vitest v8 coverage matches Istanbul accuracy via AST remapping (since Vitest v3.2). `audit-ci` allows allowlisting and severity thresholds.
- Cons: Five new dev deps; ~30 lines of config. Initial lint cleanup may surface latent issues.
- Fit: Best for a TS-strict project.

**Option B — Biome (single combined linter + formatter)**
- Pros: One tool replaces ESLint + Prettier; very fast; zero-config defaults.
- Cons: Smaller rule set than typescript-eslint; some TS-specific rules (e.g., `no-floating-promises`) are not yet at parity. Project already uses TypeScript-specific patterns (catch with `unknown`, etc.) where typescript-eslint has dedicated rules.
- Fit: Acceptable but loses the deep TypeScript-aware rules.

**Option C — Just typescript-eslint, skip Prettier**
- Pros: Half the config.
- Cons: Mixing lint + style is a known pain point ESLint stopped doing in v8; ESLint authors recommend a dedicated formatter.
- Fit: Mediocre.

### Recommendation

**Option A.** typescript-eslint flat config with `tseslint.configs.strict` + `tseslint.configs.stylistic`, Prettier with default config, `vitest run --coverage` using v8 provider, and `audit-ci --moderate` (fail on moderate or higher) as a separate CI step. Add the lint+format+coverage commands to the existing CI workflow as parallel jobs to keep CI fast.

### Sources

- [typescript-eslint — Getting Started](https://typescript-eslint.io/getting-started/) — official setup; documents flat config + recommended rule sets.
- [Vitest — Coverage](https://vitest.dev/guide/coverage) — official; documents v8 vs istanbul providers and CI patterns.
- [`audit-ci` (IBM)](https://github.com/IBM/audit-ci) — actively maintained; threshold + allowlist support; widely used in CI.

---

## D-1 — No `LICENSE` file at repo root — MEDIUM

**Finding restated:** No `LICENSE`, no `"license"` field in `package.json`, no license section in README. Default copyright is "all rights reserved," which is legally ambiguous for a distributed Even Hub plugin.

### Candidate approaches

**Option A — Apache 2.0**
- Pros: Includes an explicit patent grant from contributors — material for a project that touches BLE protocol research (D-0003) and may eventually want to accept community contributions on hardware-protocol code. About 30% of OSS uses Apache 2.0.
- Cons: Longer (~1700 words) than MIT; requires a NOTICE file for redistributions.
- Fit: Best for a project with potential hardware/protocol IP concerns and possible future contributions.

**Option B — MIT**
- Pros: Shortest permissive license (~170 words). Most-used license (27% of OSS). Lowest friction for any reuse.
- Cons: No patent grant. For a project where "BLE writes outside the official Even Hub SDK require a per-experiment safety gate" (D-0003), the absence of a patent grant could matter if the project ever publishes BLE-related code.
- Fit: Good if Tony's read is "this is small and IP isn't a concern."

**Option C — Explicit "UNLICENSED" / "All rights reserved" in `package.json`**
- Pros: Removes legal ambiguity without committing to OSS.
- Cons: Blocks any third party redistribution — including community Even Hub plugin sharing.
- Fit: Reasonable interim default if Tony hasn't decided.

### Recommendation

**Option A — Apache 2.0** if Tony intends to share the plugin or accept contributions; **Option C — UNLICENSED** as the explicit interim if not. The two options are about audience: Apache for "I want others to be able to fork this safely"; UNLICENSED for "this is mine for now." Don't leave it ambiguous — `package.json` `license` field should always be set, per the npm `package.json` docs.

### Sources

- [Choose a License — Apache License 2.0](https://choosealicense.com/licenses/apache-2.0/) — GitHub-curated authoritative comparison resource.
- [Choose a License — Licenses](https://choosealicense.com/licenses/) — overview of the choices and trade-offs.
- [npm — `package.json` license field](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#license) — npm convention for declaring licenses (or `"UNLICENSED"`).

---

## O-1 — Catch blocks swallow original errors at multiple sites — MEDIUM

**Finding restated:** All cited `catch` blocks discard the caught value; the original `Error.message`/stack never surfaces, so the operator gets only a static visual string.

### Candidate approaches

**Option A — Bind `error: unknown`, log with structured logger before transforming**
- Pros: Minimal change; uniform pattern. Combined with `useUnknownInCatchVariables` (already on under strict, per `tsconfig.json:11`), the type system guides correct handling.
- Cons: Need to instantiate a structured logger first (depends on O-2).
- Fit: Best.

**Option B — Result-type pattern (`Result<T, E>`)**
- Pros: Compile-time enforcement that errors are handled.
- Cons: Significant refactor. Idiomatic in Rust/Effect-TS, less so in vanilla TS.
- Fit: Out of proportion to the prototype.

**Option C — typescript-eslint rule `use-unknown-in-catch-callback-variable` to enforce binding**
- Pros: Mechanical enforcement that every catch binds the variable.
- Cons: Catches the binding but not the swallowing; still need Option A's logging discipline.
- Fit: Pair with A.

### Recommendation

**Option A + Option C as a guardrail.** Bind `error: unknown` everywhere, log via the Pino logger (O-2 recommendation) with `{err: error}` as the structured field, then transform to the visual status. Pino's serializer for `err` extracts message/stack/name automatically. Add the `use-unknown-in-catch-callback-variable` rule via T-4's typescript-eslint config to keep this enforced going forward.

### Sources

- [TypeScript — `useUnknownInCatchVariables` (tsconfig)](https://www.typescriptlang.org/tsconfig/useUnknownInCatchVariables.html) — official; documents the strict-mode behavior.
- [typescript-eslint — `use-unknown-in-catch-callback-variable` rule](https://typescript-eslint.io/rules/use-unknown-in-catch-callback-variable/) — official typescript-eslint docs.

---

## O-2 — Logging is unstructured and inconsistent — MEDIUM

**Finding restated:** Mix of `console.info` (browser tag prefix), `console.log` (server, prefixed), and bare `console.log` (CLI runners). No log levels, no shared JSON shape.

### Candidate approaches

**Option A — Pino on the Node side, structured `console.info` on the WebView side**
- Pros: Pino is the de-facto Node structured-logging library: 5× faster than Winston, JSON by default, child-logger support for context, pino-pretty for development. WebView can keep `console.info` but structure the payload (level, message, details) so `/client-log` ingests JSON. Cohesive.
- Cons: One new dep on the Node side; WebView side is convention-only.
- Fit: Best.

**Option B — Winston (older logger, well-known)**
- Pros: Larger transport ecosystem.
- Cons: ~5× slower than Pino; less idiomatic for new Node projects in 2026.
- Fit: Mediocre — picking it would buy compatibility but at a cost.

**Option C — Custom small logger module shared between WebView and broker**
- Pros: Zero deps; uniform shape.
- Cons: Reinvents what Pino already does well; misses Pino's redaction, child loggers, transport pipelines.
- Fit: Acceptable but wasteful.

### Recommendation

**Option A — Pino + structured WebView console.** Pino on the broker; on the WebView side, redefine `logClientStage` to output `{level, stage, details, at}` to both `console.info` and `/client-log`. The `/client-log` endpoint already POSTs JSON, so the broker's Pino logger can re-emit it on its own pipeline. Use `pino-pretty` only in dev; raw JSON in CI/hardware-smoke runs. This unblocks O-1 (logger needed for catch sites) and O-3 (health-check log lines look the same as everything else).

### Sources

- [pino (GitHub)](https://github.com/pinojs/pino) — maintainer-authoritative; JSON-by-default, NDJSON output, performance characteristics.
- [SigNoz — Pino Logger Complete Guide (2026)](https://signoz.io/guides/pino-logger/) — secondary engineering reference; useful for the dev/prod transport pattern.
- [Better Stack — Pino guide](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/) — secondary.

---

## O-3 — Token broker has no `/health` or readiness endpoint — MEDIUM

**Finding restated:** No `/health`, `/healthz`, `/ready`, or `/-/health` route on the broker. `hardware/readiness.ts:48-50` substitutes a `curl -X OPTIONS` probe.

### Candidate approaches

**Option A — Single `/healthz` endpoint, HTTP 200 with no body (or `{ok:true}`)**
- Pros: De-facto Kubernetes/Node convention. Cheap to add. Replaces the `OPTIONS`-probe hack with a real signal.
- Cons: Doesn't distinguish liveness from readiness — fine here since the broker has no upstream readiness to check beyond "the process is running."
- Fit: Best for a local dev tool.

**Option B — Separate `/livez` and `/readyz` (Kubernetes idiomatic split)**
- Pros: Forward-compatible with cloud deployment.
- Cons: Broker isn't deployed to Kubernetes; readiness has nothing meaningful to check (no DB, no upstream that the broker is *gating on*). Pure ceremony.
- Fit: Overkill.

**Option C — Use `lightship` (Kubernetes-aware health/readiness library)**
- Pros: Handles graceful shutdown signal flow alongside health probes — relevant to O-5 too.
- Cons: New dep for a single endpoint at this scale.
- Fit: Worth considering only if Tony plans to deploy the broker beyond local dev.

### Recommendation

**Option A.** Add `GET /healthz` returning HTTP 200 with `{ok:true, version:"0.1.0"}`. The Node.js Reference Architecture (Nodeshift, an IBM-supported project) explicitly recommends `/readyz` and `/livez`, but for a broker with no upstream-readiness story the single `/healthz` is enough — it's also what the existing hardware-smoke probe needs. Update `hardware/readiness.ts` probes to use it instead of `OPTIONS`.

### Sources

- [Node.js Reference Architecture — Health Checks (Nodeshift)](https://nodeshift.dev/nodejs-reference-architecture/operations/healthchecks/) — IBM-supported reference architecture; documents the `/readyz` / `/livez` convention and when each is appropriate.
- [Kubernetes — Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/) — authoritative on the readiness vs liveness distinction; cited as why the simpler `/healthz` is sufficient here.

---

## O-4 — Broker has no `uncaughtException` / `unhandledRejection` handler — MEDIUM

**Finding restated:** No `process.on('uncaughtException', ...)` or `process.on('unhandledRejection', ...)` registration. Since Node 15+ unhandled rejections crash the process by default, but the WS upgrade callback and `deepgramProxyServer.on('connection', ...)` are not wrapped.

### Candidate approaches

**Option A — Log + graceful shutdown + exit (let process manager restart)**
- Pros: Aligns with Node.js project best-practice ("crash on uncaught, log details, restart"). The structured logger from O-2 captures context; the SIGINT/SIGTERM handler from O-5 handles the graceful close.
- Cons: Requires O-2 (logger) and a process supervisor in production. For local dev, the developer just re-runs `npm run token-broker`.
- Fit: Best.

**Option B — Log + continue (suppress crash)**
- Pros: Broker stays up.
- Cons: "Don't continue in an undefined state" is the universally cited best practice. Risk of cascading corruption.
- Fit: Anti-pattern.

**Option C — Use `lightship` to coordinate handlers + shutdown**
- Pros: One library handles uncaught, signals, and `/healthz` together (combines O-3 / O-4 / O-5).
- Cons: New dep for a local dev tool.
- Fit: Worth considering only if O-3 also picks lightship.

### Recommendation

**Option A.** Register both handlers, log with `log.fatal({err}, 'uncaught exception')`, then call the same graceful-shutdown routine the SIGINT handler will use (close upstream WS sockets, drain any pending HTTP writes, then `process.exit(1)`). For local dev, the developer restarts; in any future deployment, a process supervisor like systemd / PM2 picks it up. Node.js docs explicitly call out that `uncaughtException` "is a crude mechanism" and recommend log-and-exit rather than log-and-continue.

### Sources

- [Node.js Process docs — `uncaughtException` event](https://nodejs.org/api/process.html#event-uncaughtexception) — authoritative; explicitly states the log-and-exit recommendation.
- [DEV Community — The Silent Killers in Node.js: uncaughtException and unhandledRejection](https://dev.to/silentwatcher_95/the-silent-killers-in-nodejs-uncaughtexception-and-unhandledrejection-1p9b) — secondary engineering write-up of the pattern; useful for the structured-logging integration angle.

---
