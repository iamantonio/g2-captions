import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Even Hub manifest network permission', () => {
  it('whitelists only the AssemblyAI streaming origin for the approved live ASR benchmark', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'app.json'), 'utf8'))

    expect(manifest.permissions).toEqual([
      {
        name: 'network',
        desc: 'Connects to AssemblyAI Streaming Speech-to-Text for approved live caption benchmark sessions.',
        whitelist: ['https://streaming.assemblyai.com'],
      },
    ])
  })
})
