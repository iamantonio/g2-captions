# G2 Captions Finished Product Plan

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task when execution begins.

Goal: Turn the current G2 Captions prototype into an alpha-ready product using Deepgram nova-3 as the default live ASR provider.

Assumptions / Open Questions:

- Deepgram remains the product default. ElevenLabs remains behind `?asr=elevenlabs` as an experimental fallback only.
- V1 ships through Even Hub as an alpha / controlled distribution, not a public unlimited app.
- API keys stay server-side in the broker. The shipped WebView may contain only the broker base URL and bearer-style installed-user token if we keep the current Fly.io design.
- No always-on/background/phone-lock claims until hardware evidence exists.
- No claim that this beats Conversate until measured side-by-side on real hardware.

Smallest Viable Approach: Finish a narrow alpha: one obvious Start/Stop production UI, Deepgram captions on the lens, visual-only failures, broker deployed to Fly.io, packaged `.ehpk`, and a repeatable acceptance checklist. Defer accounts, billing, offline fallback, and wearer-voice suppression unless they block alpha usability.

Architecture: Keep the current provider seam and make Deepgram the only production path. Keep ElevenLabs code but hide it behind debug query flags. Broker remains the server-side auth/proxy boundary for Deepgram.

Tech Stack: Vite, TypeScript, Vitest, Even Hub SDK, Deepgram nova-3 streaming, Node token broker, Fly.io deployment, Even Hub CLI packaging.

Verification: Alpha is complete when a clean install on G2 can start captions from the production UI, stream G2 SDK audio through deployed Deepgram broker, show readable captions on lens and phone, stop cleanly, and pass the acceptance checklist plus `npm test`, `npm run build`, and `evenhub pack`.

---

## Phase A — Freeze the product direction

### Task A1: Record Deepgram as the shipping default

Objective: Update product docs/decisions so future work does not keep re-litigating the provider choice.

Files:

- Modify: `DECISIONS.md`
- Modify: `README.md`
- Optional create/modify: `docs/15-provider-finalization.md`

Steps:

1. Add a new decision: `D-0012 — Ship alpha on Deepgram nova-3; ElevenLabs remains experimental fallback`.
2. Summarize evidence:
   - Deepgram first visible caption remains fastest.
   - ElevenLabs VAD is viable but slower to first partial.
   - ElevenLabs manual commit is not suitable for conversation due mid-word commits / fragments.
3. Update README current status from “Phase 2 prototype” to “Deepgram alpha hardening”.
4. Run: `npm test`.
5. Commit docs.

Acceptance:

- README clearly says Deepgram is default.
- ElevenLabs is documented as debug/experimental only.

---

## Phase B — Product UI polish and session lifecycle

### Task B1: Audit the production UI default path

Objective: Confirm the non-debug URL behaves like a product, not a dev panel.

Files:

- Inspect/modify: `src/app/UIShell.ts`
- Inspect/modify: `public/styles.css`
- Test: `tests/unit/UIShell.test.ts`
- Test: `tests/integration/appWiring.test.ts`

Steps:

1. Open production URL without `?debug=1`.
2. Verify there is one primary action: Start / Stop captions.
3. Verify no raw provider buttons, fixture controls, or telemetry dump appear by default.
4. Add/adjust tests if any dev controls leak into production mode.
5. Run targeted tests.

Acceptance:

- Non-debug mode is simple: status, caption surface, one primary action.
- Debug mode still exposes tools.

### Task B2: Make Start/Stop robust

Objective: Make session lifecycle reliable enough for non-developer use.

Files:

- Modify: `src/app/ASRController.ts`
- Modify: `src/app/AudioController.ts`
- Modify: `src/audio/g2SdkAudio.ts`
- Tests: `tests/unit/ASRController.test.ts`, `tests/unit/AudioController.test.ts`, `tests/unit/g2SdkAudio.test.ts`

Steps:

1. Ensure Start cannot create duplicate ASR/audio sessions.
2. Ensure Stop closes Deepgram with `CloseStream`, stops G2 audio, and renders a stopped visual state.
3. Ensure WebSocket close/error stops audio or clearly tells the user to restart.
4. Add tests for double-start, stop-during-connect, provider-close, and audio-send failure.
5. Run targeted tests.

Acceptance:

- Repeated Start/Stop does not leave stale mic/audio sessions.
- Every failure is visual.

### Task B3: Add visible setup/permission guidance

Objective: Reduce user confusion on first launch and permission failures.

Files:

- Modify: `src/app/UIShell.ts`
- Modify: `src/captions/visualErrors.ts` if needed
- Tests: `tests/integration/accessibilityFallback.test.ts`

Steps:

1. Add plain-language guidance: “Open on G2, press Start, keep phone nearby.”
2. Add clear messages for broker unavailable, mic unavailable, ASR unavailable, and bridge unavailable.
3. Ensure messages render on phone and lens.
4. Run accessibility fallback tests.

Acceptance:

- A non-developer can understand what to do and what failed.

---

## Phase C — Deepgram caption quality hardening

### Task C1: Tune Deepgram endpointing for conversation readability

Objective: Reduce “all over the place” behavior without switching providers.

Files:

- Modify: `src/asr/DeepgramStreamingClient.ts`
- Test: `tests/unit/deepgramClient.test.ts`
- Docs: `docs/15-provider-finalization.md` or next phase doc

Steps:

1. Make endpointing configurable server-side or runtime-configurable with a safe default.
2. Test candidate defaults: 250ms current, 500ms, 750ms.
3. Use same phrase set on G2 hardware.
4. Choose the best readability/latency compromise.
5. Record evidence.

Acceptance:

- Selected Deepgram config has hardware telemetry evidence.
- No vendor-switching needed.

### Task C2: Suppress duplicate/no-op caption updates

Objective: Reduce visual churn on the lens.

Files:

- Modify: `src/captions/CaptionState.ts`
- Modify: `src/app/ASRController.ts` or render scheduler if needed
- Tests: `tests/unit/captionState.test.ts`, `tests/unit/renderScheduler.test.ts`

Steps:

1. Add test where identical partial text arrives repeatedly.
2. Avoid lens updates when displayed frame text would not change.
3. Keep finals flushing immediately.
4. Run tests.

Acceptance:

- Identical repeats do not repaint lens unnecessarily.
- Final captions still lock quickly.

### Task C3: Confirm speaker label behavior

Objective: Decide whether V1 can show speaker labels confidently.

Files:

- Inspect/modify: `src/asr/DeepgramStreamingClient.ts`
- Inspect/modify: `src/captions/formatter.ts`
- Docs: `docs/13-first-hardware-run.md` or new evidence doc

Steps:

1. Run two-person G2 hardware test with Deepgram.
2. Inspect telemetry `speakerWordCounts` / speaker labels.
3. If labels are reliable enough, keep `[S1]`, `[S2]` chips.
4. If labels collapse to one speaker, hide chips or label as experimental rather than misleading.

Acceptance:

- Speaker labels are either verified or intentionally disabled/softened.

---

## Phase D — Production broker and deployment

### Task D1: Deploy broker to Fly.io

Objective: Make the app work outside the local LAN dev server.

Files:

- Verify/modify: `fly.toml`
- Verify/modify: `tools/token-broker.ts`
- Verify/modify: `README.md`

Steps:

1. Run `fly auth login` manually as Antonio if not already authenticated.
2. Create/select Fly app.
3. Set secrets:
   - `DEEPGRAM_API_KEY`
   - `VITE_BROKER_AUTH_TOKEN`
4. Deploy with `fly deploy`.
5. Verify `/healthz`.
6. Verify `/deepgram/listen` upgrade path without exposing keys.

Acceptance:

- Broker is reachable over HTTPS/WSS from phone network.

### Task D2: Lock down broker abuse controls

Objective: Prevent accidental cost blowups during alpha.

Files:

- Modify: `src/asr/createTokenBrokerServer.ts`
- Tests: `tests/integration/tokenBroker.test.ts`

Steps:

1. Confirm rate limits are active in production.
2. Add max session duration / idle timeout if missing.
3. Add request logging that avoids secrets and raw audio.
4. Add a documented Deepgram usage cap checklist item.
5. Run broker tests.

Acceptance:

- Broker has rate caps, session caps, and safe logs.

### Task D3: Build production `.ehpk`

Objective: Produce an installable artifact pointed at the deployed broker.

Files:

- Modify: `app.json` whitelist with chosen Fly hostname
- Build output: `g2-captions.ehpk`

Steps:

1. Set `VITE_BROKER_BASE_URL=https://<fly-app>.fly.dev`.
2. Run `npm run build`.
3. Run `evenhub pack app.json dist -o g2-captions.ehpk`.
4. Upload through Even Hub portal.
5. Install on G2.

Acceptance:

- Installed app launches and reaches deployed broker.

---

## Phase E — Acceptance testing on real hardware

### Task E1: Create alpha acceptance checklist

Objective: Define what “finished” means before shipping.

Files:

- Create: `docs/alpha-acceptance-checklist.md`

Checklist:

- Fresh install opens without black screen.
- Start begins G2 mic capture.
- Caption appears on lens within measured acceptable time.
- Stop ends mic and ASR stream.
- Broker outage is visual on phone/lens.
- Provider outage is visual on phone/lens.
- Phone UI is readable in light/dark environments.
- Lens frame fits without overflow/truncating critical state.
- Debug URL still works for diagnostics.
- No API keys in bundle or logs.
- Deepgram usage cap set.

Acceptance:

- Checklist exists and is used for every release candidate.

### Task E2: Run release-candidate hardware pass

Objective: Produce evidence for alpha release.

Files:

- Create: `docs/16-alpha-hardware-pass.md`
- Store ignored artifacts under `artifacts/` if needed

Steps:

1. Test short phrase.
2. Test long natural sentence.
3. Test noisy room / TV background if available.
4. Test two speakers.
5. Test Stop/Start twice.
6. Test broker unavailable if safe.
7. Paste telemetry summaries and decisions into doc.

Acceptance:

- Release candidate either passes or has a short blocking-bug list.

---

## Phase F — Release hygiene

### Task F1: Remove or hide experimental clutter

Objective: Make alpha codebase and bundle understandable.

Files:

- Inspect: `src/asr/ElevenLabs*`
- Inspect: `tools/run-elevenlabs-scribe-smoke.ts`
- Inspect: `README.md`

Steps:

1. Keep ElevenLabs only if it remains useful behind debug flag.
2. Ensure it cannot be selected accidentally in production UI.
3. Document it as experimental fallback.
4. Do not delete working code unless it complicates packaging/review.

Acceptance:

- Product path is Deepgram; experimental paths are clearly gated.

### Task F2: Version and release notes

Objective: Prepare an alpha release artifact.

Files:

- Modify: `package.json`
- Modify: `app.json`
- Create: `docs/releases/v0.8.0-alpha.md`

Steps:

1. Pick version, likely `0.8.0-alpha` or next Even Hub-compatible semver.
2. Update manifest/package if needed.
3. Record known limitations:
   - Needs phone/app active.
   - No always-on/background claim.
   - No Conversate superiority claim yet.
   - Speaker labels dependent on Deepgram/G2 audio quality.
4. Build/pack.

Acceptance:

- A named alpha release exists with artifact and limitations.

## Recommended execution order

1. A1 — lock Deepgram decision.
2. B2 — robust lifecycle, because broken Start/Stop kills product trust.
3. C2 — reduce caption churn.
4. C1 — tune Deepgram endpointing on real hardware.
5. D1-D3 — deploy broker + package `.ehpk`.
6. E1-E2 — run acceptance checklist.
7. F1-F2 — release hygiene and alpha notes.

## Definition of alpha-ready

G2 Captions is alpha-ready when:

- A non-debug install starts and stops captions from one obvious control.
- Deepgram captions appear on the G2 lens from real G2 mic audio.
- Failures are visual and understandable.
- Broker is deployed; no local Mac required.
- Usage is capped/monitored.
- Packaging passes.
- Hardware acceptance checklist passes.
- Known limitations are documented honestly.
