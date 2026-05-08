import { describe, expect, it } from 'vitest'
import { OpenAiSmokeCompletionTracker } from '../../tools/openaiSmokeCompletion'

describe('OpenAiSmokeCompletionTracker', () => {
  it('keeps the smoke socket open when OpenAI finalizes one utterance before fixture streaming has finished', () => {
    const tracker = new OpenAiSmokeCompletionTracker()

    tracker.markFinalTranscript('Can you see captions?')

    expect(tracker.shouldCloseSocket()).toBe(false)
    expect(tracker.finalText).toBe('Can you see captions?')

    tracker.markFixtureStreamingComplete()
    expect(tracker.shouldCloseSocket()).toBe(false)

    tracker.markFinalTranscript('Yes, captions are visible.')

    expect(tracker.shouldCloseSocket()).toBe(true)
    expect(tracker.finalText).toBe('Can you see captions? Yes, captions are visible.')
    expect(tracker.finalTranscriptCount).toBe(2)
  })
})
