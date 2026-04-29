import type { FixtureAsrScriptEvent, RawAsrEvent } from '../types'

export class FixtureAsrClient {
  constructor(private readonly script: FixtureAsrScriptEvent[]) {}

  async transcribeFixture(): Promise<RawAsrEvent[]> {
    return this.script.map((event) => ({
      vendor: 'fixture',
      text: event.text,
      status: event.status,
      startMs: event.startMs,
      endMs: event.endMs,
      speaker: event.speaker,
      receivedAtMs: event.delayMs,
    }))
  }
}
