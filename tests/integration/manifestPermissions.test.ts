import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Even Hub manifest network permission', () => {
  it('whitelists the deployed broker (HTTPS + WSS) and the Deepgram upstream for live ASR sessions', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'app.json'), 'utf8'))

    expect(manifest.permissions).toEqual([
      {
        name: 'network',
        desc: 'Connects to the deployed g2-captions broker (which proxies Deepgram Streaming Speech-to-Text) for approved live caption sessions.',
        whitelist: [
          'https://api.deepgram.com',
          'https://g2-captions-broker.fly.dev',
          'wss://g2-captions-broker.fly.dev',
        ],
      },
    ])
  })
})
