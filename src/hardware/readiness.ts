export interface HardwareSmokeUrls {
  lanIp: string
  viteUrl: string
  tokenBrokerUrl: string
  qrCommand: string
}

export interface HardwareReadinessChecklist {
  urls: HardwareSmokeUrls
  commands: string[]
  probes: string[]
  requiredVisualStates: string[]
  manualObservations: string[]
  warnings: string[]
}

export function isPrivateLanIp(ip: string): boolean {
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return true
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip)) return true
  const match = /^172\.(\d{1,2})\.\d{1,3}\.\d{1,3}$/.exec(ip)
  return match ? Number(match[1]) >= 16 && Number(match[1]) <= 31 : false
}

export function buildHardwareSmokeUrls(lanIp: string): HardwareSmokeUrls {
  const viteUrl = `http://${lanIp}:5173`
  return {
    lanIp,
    viteUrl,
    tokenBrokerUrl: `http://${lanIp}:8787/assemblyai/token`,
    qrCommand: `evenhub qr --url "${viteUrl}"`,
  }
}

export function buildHardwareReadinessChecklist(lanIp: string): HardwareReadinessChecklist {
  const urls = buildHardwareSmokeUrls(lanIp)
  const warnings = isPrivateLanIp(lanIp)
    ? []
    : [`${lanIp} does not look like a private LAN IP reachable from the phone`]

  return {
    urls,
    commands: [
      'set -a && . ./.env && set +a && HOST=0.0.0.0 npm run token-broker',
      'npm run dev -- --host 0.0.0.0 --port 5173',
      urls.qrCommand,
    ],
    probes: [
      `curl -I --max-time 5 "${urls.viteUrl}/"`,
      `curl -i --max-time 10 -X OPTIONS -H "Origin: ${urls.viteUrl}" "${urls.tokenBrokerUrl}"`,
      `curl -sS --max-time 15 -X POST -H "Origin: ${urls.viteUrl}" "${urls.tokenBrokerUrl}" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s); console.log('token_present=', typeof j.token === 'string' && j.token.length > 10); console.log('expiresInSeconds=', j.expiresInSeconds);})"`,
    ],
    requiredVisualStates: [
      'HARDWARE SMOKE — connecting ASR',
      'ASR CONNECTED — waiting audio',
      'AUDIO SPEECH FIXTURE STREAMING',
      'G2 MIC STARTING — waiting audio',
      'G2 MIC LIVE — captions streaming',
      'G2 MIC FAILED — bridge unavailable',
      'G2 MIC STREAM FAILED — captions paused',
      'LIVE AUDIO STOPPED — captions paused',
      'ASR TERMINATED',
    ],
    manualObservations: [
      'G2 firmware/device version',
      'Even Hub app version',
      'phone model and OS version',
      'whether audioEvent.audioPcm arrives continuously',
      'first partial latency from telemetry JSON',
      'final transcript latency from telemetry JSON',
      'phone lock/background behavior',
      'lens-visible error state, if any',
    ],
    warnings,
  }
}

export function formatHardwareReadinessReport(checklist: HardwareReadinessChecklist): string {
  const lines = [
    '# Hardware readiness smoke',
    '',
    `LAN URL: ${checklist.urls.viteUrl}`,
    `Token broker URL: ${checklist.urls.tokenBrokerUrl}`,
    `QR: ${checklist.urls.qrCommand}`,
    '',
    '## Commands',
    ...checklist.commands.map((command) => `- \`${command}\``),
    '',
    '## Probes',
    ...checklist.probes.map((probe) => `- \`${probe}\``),
    '',
    'Probe note: token sanity checks should print `token_present= true` and never print raw token values or ASSEMBLYAI_API_KEY.',
    '',
    '## Required visual states',
    ...checklist.requiredVisualStates.map((state) => `- ${state}`),
    '',
    '## Manual observations',
    ...checklist.manualObservations.map((observation) => `- ${observation}`),
  ]

  if (checklist.warnings.length > 0) {
    lines.push('', '## Warnings', ...checklist.warnings.map((warning) => `- ${warning}`))
  }

  return `${lines.join('\n')}\n`
}
