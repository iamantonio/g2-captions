import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Even Hub manifest network permission', () => {
  it('whitelists deployed broker, Deepgram, and gated ElevenLabs Scribe test origins for live ASR sessions', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'app.json'), 'utf8'))

    expect(manifest.permissions).toEqual([
      {
        name: 'network',
        desc: 'Connects to the deployed g2-captions broker plus approved ASR streaming origins for live caption sessions.',
        whitelist: [
          'https://api.deepgram.com',
          'https://api.elevenlabs.io',
          'wss://api.elevenlabs.io',
          'https://g2-captions-broker.fly.dev',
          'wss://g2-captions-broker.fly.dev',
        ],
      },
    ])
  })
})
