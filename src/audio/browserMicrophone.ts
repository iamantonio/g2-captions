import type { PcmChunk } from './pcmFixture'

export interface DownsampleFloat32ToPcmS16LeOptions {
  inputSampleRate: number
  outputSampleRate: number
}

export interface BrowserMicrophonePcmSourceOptions {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createAudioContext?: () => AudioContext
  onChunk: (chunk: PcmChunk) => void | Promise<void>
  onVisualStatus: (status: string) => void
  /**
   * Optional structured-error sink, called with the original caught value
   * before reducing it to a visual status.
   */
  onError?: (stage: string, err: unknown, details?: Record<string, unknown>) => void
  outputSampleRate?: number
  chunkMs?: number
}

interface ScriptProcessorLike {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null
  connect(destination: AudioNode): void
  disconnect(): void
}

export class BrowserMicrophonePcmSource {
  private stream: MediaStream | undefined
  private audioContext: AudioContext | undefined
  private processor: ScriptProcessorLike | undefined
  private seq = 0

  constructor(private readonly options: BrowserMicrophonePcmSourceOptions) {}

  async start(): Promise<void> {
    this.options.onVisualStatus('BROWSER MIC PERMISSION — waiting')
    const getUserMedia = this.options.getUserMedia ?? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    try {
      this.stream = await getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } })
    } catch (err) {
      this.options.onError?.('browser_mic_permission_denied', err)
      this.options.onVisualStatus('BROWSER MIC DENIED — captions paused')
      throw new Error('Browser microphone permission denied', { cause: err })
    }

    this.audioContext = this.options.createAudioContext?.() ?? new AudioContext()
    this.tryAttachProcessor()
    this.options.onVisualStatus('BROWSER MIC LIVE — captions streaming')
  }

  async stop(): Promise<void> {
    this.processor?.disconnect()
    this.processor = undefined
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = undefined
    await this.audioContext?.close()
    this.audioContext = undefined
    this.options.onVisualStatus('BROWSER MIC STOPPED — captions paused')
  }

  private tryAttachProcessor(): void {
    const context = this.audioContext
    const stream = this.stream
    if (!stream || !context || !context.createMediaStreamSource || !context.createScriptProcessor) return
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1) as ScriptProcessorLike
    processor.onaudioprocess = (event) => {
      const samples = event.inputBuffer.getChannelData(0)
      const data = downsampleFloat32ToPcmS16Le(samples, {
        inputSampleRate: context.sampleRate,
        outputSampleRate: this.options.outputSampleRate ?? 16_000,
      })
      this.seq += 1
      void this.options.onChunk({
        seq: this.seq,
        data,
        durationMs: Math.round((new Int16Array(data).length / (this.options.outputSampleRate ?? 16_000)) * 1000),
      })
    }
    source.connect(processor as unknown as AudioNode)
    processor.connect(context.destination)
    this.processor = processor
  }
}

export function downsampleFloat32ToPcmS16Le(
  input: Float32Array,
  options: DownsampleFloat32ToPcmS16LeOptions,
): ArrayBuffer {
  const ratio = options.inputSampleRate / options.outputSampleRate
  const outputLength = Math.max(1, Math.floor(input.length / ratio))
  const output = new Int16Array(outputLength)
  for (let index = 0; index < outputLength; index += 1) {
    const sample = clamp(input[Math.floor(index * ratio)] ?? 0, -1, 1)
    output[index] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767)
  }
  return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
