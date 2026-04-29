import { execFileSync } from 'node:child_process'
import { buildHardwareReadinessChecklist, formatHardwareReadinessReport } from '../src/hardware/readiness'

function detectLanIp(): string {
  const envIp = process.env.LAN_IP?.trim()
  if (envIp) return envIp

  for (const iface of ['en0', 'en1']) {
    try {
      const output = execFileSync('ipconfig', ['getifaddr', iface], { encoding: 'utf8' }).trim()
      if (output) return output
    } catch {
      // Try next interface.
    }
  }

  return '127.0.0.1'
}

const checklist = buildHardwareReadinessChecklist(detectLanIp())
console.log(formatHardwareReadinessReport(checklist))
