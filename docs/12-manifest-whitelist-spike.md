# Phase 12 — Manifest network whitelist spike

Date opened: 2026-04-30
Date closed: 2026-05-01
Status: Closed — Outcome 1 (whitelist is permissive for loopback / LAN).
See `docs/13-first-hardware-run.md` for the verifying run.

## Question

`app.json` whitelists `https://api.deepgram.com`, but the WebView never
talks to that origin directly. Its actual outbound calls are
`http://<host>:8787/deepgram/token`, `ws://<host>:8787/deepgram/listen`,
and `http://<host>:8787/client-log` (resolved by `src/app/runtimeConfig.ts`).
The broker — not the WebView — is what reaches `wss://api.deepgram.com`.

Two possible explanations:

1. Even Hub silently allows loopback / LAN regardless of whitelist, so the
   `https://api.deepgram.com` entry is decorative.
2. The whitelist is wrong and the WebView is blocked on real hardware
   from reaching its own broker.

## What we don't know

- Whether Even Hub WebView enforces the whitelist for `http://` hosts on
  the same LAN as the phone.
- Whether the whitelist applies to `ws://` upgrades.
- Whether `localhost` / `127.0.0.1` get an automatic exemption.

## How to resolve

Either of:

- **Hardware test:** flash the current build to G2, watch the broker log
  for the WebView's `/deepgram/token` POST. If the request never arrives,
  the whitelist is blocking; if it does, the whitelist is permissive for
  loopback / LAN.
- **SDK source review:** read `@evenrealities/even_hub_sdk` (or the
  Even Hub host app source if available) for the whitelist enforcement
  semantics.

Time-box: 2 hours.

## Outcome — 2026-05-01

**Outcome 1.** The Even Hub WebView reached
`http://<lan-ip>:8787/deepgram/token` and
`ws://<lan-ip>:8787/deepgram/listen` from a build that only declared
`https://api.deepgram.com` in `app.json` `permissions[].whitelist`.
Token POST landed on the broker and the WS proxy upgrade completed —
the auto-smoke fixture flow ran end-to-end and the lens displayed
`SMOKE OK`.

**Conclusion.** The manifest whitelist is **permissive for loopback /
LAN** in the SDK version under test (`@evenrealities/even_hub_sdk`
`^0.0.10`, Even Hub host app version recorded in
`docs/13-first-hardware-run.md`). The whitelist entry is therefore
advisory / contractual rather than enforced for non-public origins.

**Action taken.** No manifest change. The
`https://api.deepgram.com` entry stays in `app.json` to document the
broker's actual upstream and to keep
`tests/integration/manifestPermissions.test.ts` meaningful as a
guard-rail.

**Caveats.**

- Re-evaluate if the SDK pins to a newer Even Hub host version
  (D-0007 in `DECISIONS.md`).
- The result was observed for `http://` and `ws://` over LAN; not
  for `https://` to a non-whitelisted public origin. If a future
  vendor adapter needs to reach a different public host directly
  from the WebView, that case requires its own check.
