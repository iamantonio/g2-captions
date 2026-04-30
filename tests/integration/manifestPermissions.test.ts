import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Even Hub manifest network permission', () => {
  it('whitelists only the Deepgram streaming origin for the approved live ASR benchmark', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'app.json'), 'utf8'))

    expect(manifest.permissions).toEqual([
      {
        name: 'network',
        desc: 'Connects to Deepgram Streaming Speech-to-Text for approved live caption benchmark sessions.',
        whitelist: ['https://api.deepgram.com'],
      },
    ])
  })
})
