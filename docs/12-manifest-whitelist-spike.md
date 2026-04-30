# Phase 12 — Manifest network whitelist spike

Date: 2026-04-30
Status: Open spike (FIX_PLAN.md Fix #18 / AUDIT.md S-7)

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

## Outcome (TBD)

To be filled in once the spike runs. Action will be either:

- Add a LAN-broker entry to the manifest whitelist, update
  `tests/integration/manifestPermissions.test.ts` to match.
- Add a comment to `app.json` documenting that the whitelist is
  decorative / advisory and that the broker is the actual outbound surface.
