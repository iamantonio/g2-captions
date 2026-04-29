# Phase 3 — Hardware / Device Smoke Plan

Status: readiness path documented; physical-device observations still need an actual Even Hub + G2 run.

## Goal

Verify the approved app path on real G2 hardware without making unmeasured daily-driver claims.

## Start commands

Terminal 1 — token broker reachable from phone over LAN:

```bash
cd /Users/tony/Dev/EvenApps/g2-captions
set -a
. ./.env
set +a
HOST=0.0.0.0 npm run token-broker
```

Terminal 2 — Vite reachable from phone over LAN:

```bash
cd /Users/tony/Dev/EvenApps/g2-captions
npm run dev -- --host 0.0.0.0 --port 5173
```

QR/readiness helper:

```bash
npm run hardware:readiness
```

This prints the LAN URL, QR command, curl probes, required visual states, and manual observations without printing secrets.

## Probes before scanning QR

```bash
LAN_IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1)
curl -I --max-time 5 "http://$LAN_IP:5173/"
```

```bash
curl -i --max-time 10 -X OPTIONS \
  -H "Origin: http://$LAN_IP:5173" \
  "http://$LAN_IP:8787/assemblyai/token"
```

Expected token preflight:

```text
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://<LAN-IP>:5173
```

## Smoke sequence

1. Scan QR in Even Hub.
2. Confirm lens shows a non-black startup frame.
3. Confirm phone preview remains visible.
4. Confirm auto-smoke fixture path runs unless `?autoSmoke=0` is set.
5. Tap `Start G2 SDK Audio`.
6. Speak one short phrase.
7. Confirm visual states change; no sound-only feedback is required.
8. Tap `Stop Live Audio`.
9. Tap `Terminate`.

## Required observations to close Phase 3

Record date/time and:

- G2 firmware/device version
- Even Hub app version
- phone model / OS version
- whether `audioEvent.audioPcm` appears continuously
- first partial latency
- final transcript latency
- speaker-label behavior
- phone lock/background behavior
- any lens-visible error state

## Current limitation

The code and packaging path can be verified locally/CI, but this issue should only be closed after a physical hardware run or after Antonio explicitly decides simulator/readiness evidence is sufficient.
