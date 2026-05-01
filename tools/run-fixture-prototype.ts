import { runFixturePrototype } from '../src/app/runFixturePrototype'

const result = await runFixturePrototype({
  events: [
    { delayMs: 120, text: 'proven machine is ready', status: 'partial', speaker: 'A', startMs: 0, endMs: 900 },
    {
      delayMs: 260,
      text: 'proven machine is ready on gee two',
      status: 'final',
      speaker: 'A',
      startMs: 0,
      endMs: 1200,
    },
  ],
  vocabulary: [
    { canonical: 'ProvenMachine', aliases: ['proven machine'], category: 'company', priority: 10 },
    { canonical: 'G2', aliases: ['gee two'], category: 'device', priority: 5 },
  ],
})

console.log(result.frame.text)
console.log(JSON.stringify({ corrections: result.corrections, latency: result.latency }, null, 2))
