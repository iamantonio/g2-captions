export interface PcmS16LeFixture {
  data: ArrayBuffer
  sampleRate: number
  encoding: 'pcm_s16le'
}

export interface PcmChunk {
  seq: number
  data: ArrayBuffer
  durationMs: number
}

export interface CreateSilentPcmS16LeFixtureOptions {
  durationMs: number
  sampleRate: number
}

export interface ChunkPcmS16LeOptions {
  chunkMs: number
}

export interface LoadPcmS16LeFixtureOptions {
  sampleRate: number
  fetchImpl?: typeof fetch
}

export async function loadPcmS16LeFixtureFromUrl(
  url: string,
  options: LoadPcmS16LeFixtureOptions,
): Promise<PcmS16LeFixture> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`Speech PCM fixture load failed with HTTP ${response.status}`)
  }

  return {
    data: await response.arrayBuffer(),
    sampleRate: options.sampleRate,
    encoding: 'pcm_s16le',
  }
}

export function createSilentPcmS16LeFixture(options: CreateSilentPcmS16LeFixtureOptions): PcmS16LeFixture {
  const sampleCount = Math.round((options.sampleRate * options.durationMs) / 1000)
  return {
    data: new ArrayBuffer(sampleCount * 2),
    sampleRate: options.sampleRate,
    encoding: 'pcm_s16le',
  }
}

export function chunkPcmS16Le(fixture: PcmS16LeFixture, options: ChunkPcmS16LeOptions): PcmChunk[] {
  const bytesPerMs = (fixture.sampleRate * 2) / 1000
  const chunkBytes = Math.max(2, Math.round(bytesPerMs * options.chunkMs))
  const chunks: PcmChunk[] = []

  for (let offset = 0; offset < fixture.data.byteLength; offset += chunkBytes) {
    const end = Math.min(offset + chunkBytes, fixture.data.byteLength)
    const data = fixture.data.slice(offset, end)
    chunks.push({
      seq: chunks.length + 1,
      data,
      durationMs: Math.round(data.byteLength / bytesPerMs),
    })
  }

  return chunks
}
