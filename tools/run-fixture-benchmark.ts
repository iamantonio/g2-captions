import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { runFixtureBenchmarkSuite } from '../src/benchmark/fixtureBenchmark'
import {
  PHASE_22_BENCHMARK_SUITE_ID,
  phase22BenchmarkFixtures,
  phase22BenchmarkVocabulary,
} from '../src/benchmark/phase22Fixtures'

const outputPath = resolve(process.argv[2] ?? 'artifacts/phase-2.2-fixture-benchmark.json')

const report = await runFixtureBenchmarkSuite({
  suiteId: PHASE_22_BENCHMARK_SUITE_ID,
  generatedAt: new Date().toISOString(),
  vocabulary: phase22BenchmarkVocabulary,
  fixtures: phase22BenchmarkFixtures,
})

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log(`Fixture benchmark report written: ${outputPath}`)
console.log(
  JSON.stringify(
    {
      suiteId: report.suiteId,
      fixtureCount: report.aggregate.fixtureCount,
      exactMatchRate: report.aggregate.exactMatchRate,
      customVocabularyHitRate: report.aggregate.customVocabularyHitRate,
      speakerLabelHitRate: report.aggregate.speakerLabelHitRate,
      audioSource: report.audioSource,
      safety: report.safety,
    },
    null,
    2,
  ),
)
