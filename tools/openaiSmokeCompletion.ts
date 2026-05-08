export class OpenAiSmokeCompletionTracker {
  private readonly finalTranscripts: string[] = []
  private fixtureStreamingComplete = false
  private finalTranscriptCountAtStreamingComplete = 0
  private postStreamWaitComplete = false

  get finalText(): string {
    return this.finalTranscripts.join(' ').replace(/\s+/g, ' ').trim()
  }

  get finalTranscriptCount(): number {
    return this.finalTranscripts.length
  }

  markFinalTranscript(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    this.finalTranscripts.push(trimmed)
  }

  markFixtureStreamingComplete(): void {
    this.fixtureStreamingComplete = true
    this.finalTranscriptCountAtStreamingComplete = this.finalTranscripts.length
  }

  markPostStreamWaitComplete(): void {
    this.postStreamWaitComplete = true
  }

  shouldCloseSocket(): boolean {
    if (!this.fixtureStreamingComplete || this.finalTranscripts.length === 0) return false
    if (this.finalTranscripts.length > this.finalTranscriptCountAtStreamingComplete) return true
    return this.postStreamWaitComplete
  }
}
