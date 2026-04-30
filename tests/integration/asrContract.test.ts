import { describe, expect, it } from 'vitest'
import { FixtureAsrClient } from '../../src/asr/FixtureAsrClient'
import { runFixturePrototype } from '../../src/app/runFixturePrototype'

describe('FixtureAsrClient contract', () => {
  it('emits ordered partial and final transcript events with speaker labels', async () => {
    const client = new FixtureAsrClient([
      { delayMs: 100, text: 'hello ton', status: 'partial', speaker: 'A', startMs: 0, endMs: 500 },
      { delayMs: 220, text: 'hello Tony', status: 'final', speaker: 'A', startMs: 0, endMs: 700 },
    ])

    const events = await client.transcribeFixture()

    expect(events.map((event) => event.text)).toEqual(['hello ton', 'hello Tony'])
    expect(events[0]).toMatchObject({ vendor: 'fixture', status: 'partial', speaker: 'A' })
    expect(events[1]).toMatchObject({ vendor: 'fixture', status: 'final', speaker: 'A' })
  })
})

describe('runFixturePrototype', () => {
  it('runs fixture ASR through state, vocabulary correction, and lens formatter', async () => {
    const result = await runFixturePrototype({
      events: [
        { delayMs: 120, text: 'proven machine is ready', status: 'partial', speaker: 'A', startMs: 0, endMs: 900 },
        { delayMs: 260, text: 'proven machine is ready on gee two', status: 'final', speaker: 'A', startMs: 0, endMs: 1200 },
      ],
      vocabulary: [
        { canonical: 'ProvenMachine', aliases: ['proven machine'], category: 'company', priority: 10 },
        { canonical: 'G2', aliases: ['gee two'], category: 'device', priority: 5 },
      ],
    })

    expect(result.frame.text).toContain('[A] ProvenMachine is ready')
    expect(result.frame.text).toContain('G2')
    expect(result.corrections).toEqual([
      { from: 'proven machine', to: 'ProvenMachine', category: 'company' },
      { from: 'proven machine', to: 'ProvenMachine', category: 'company' },
      { from: 'gee two', to: 'G2', category: 'device' },
    ])
    expect(result.latency.frames[0].withinTarget).toBe(true)
  })
})
