import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderScheduler } from '../../src/app/renderScheduler'

describe('renderScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('schedulePartial defers the render to the end of the throttle window', () => {
    const render = vi.fn()
    const scheduler = createRenderScheduler({ render, windowMs: 150 })
    scheduler.schedulePartial()
    expect(render).not.toHaveBeenCalled()
    expect(scheduler.hasPending()).toBe(true)

    vi.advanceTimersByTime(149)
    expect(render).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(render).toHaveBeenCalledOnce()
    expect(scheduler.hasPending()).toBe(false)
  })

  it('multiple partials inside the same window collapse to a single render', () => {
    const render = vi.fn()
    const scheduler = createRenderScheduler({ render, windowMs: 150 })

    for (let i = 0; i < 10; i += 1) {
      scheduler.schedulePartial()
      vi.advanceTimersByTime(10)
    }
    // 100ms elapsed; render still pending.
    expect(render).not.toHaveBeenCalled()

    vi.advanceTimersByTime(60)
    expect(render).toHaveBeenCalledOnce()
  })

  it('a fresh schedulePartial after the window fires its own render', () => {
    const render = vi.fn()
    const scheduler = createRenderScheduler({ render, windowMs: 150 })

    scheduler.schedulePartial()
    vi.advanceTimersByTime(150)
    expect(render).toHaveBeenCalledOnce()

    scheduler.schedulePartial()
    vi.advanceTimersByTime(150)
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('flushFinal renders synchronously and cancels any pending partial', () => {
    const render = vi.fn()
    const scheduler = createRenderScheduler({ render, windowMs: 150 })

    scheduler.schedulePartial()
    expect(scheduler.hasPending()).toBe(true)

    scheduler.flushFinal()
    expect(render).toHaveBeenCalledOnce()
    expect(scheduler.hasPending()).toBe(false)

    // The cancelled partial must not fire when the timer would have elapsed.
    vi.advanceTimersByTime(500)
    expect(render).toHaveBeenCalledOnce()
  })

  it('cancel drops any pending partial without firing', () => {
    const render = vi.fn()
    const scheduler = createRenderScheduler({ render, windowMs: 150 })
    scheduler.schedulePartial()
    scheduler.cancel()
    vi.advanceTimersByTime(500)
    expect(render).not.toHaveBeenCalled()
    expect(scheduler.hasPending()).toBe(false)
  })

  it('cancel is a no-op when nothing is pending', () => {
    const render = vi.fn()
    const scheduler = createRenderScheduler({ render })
    scheduler.cancel()
    expect(render).not.toHaveBeenCalled()
    expect(scheduler.hasPending()).toBe(false)
  })

  it('partials after a flushFinal start a new throttle window (do not piggy-back on the final)', () => {
    const render = vi.fn()
    const scheduler = createRenderScheduler({ render, windowMs: 150 })

    scheduler.flushFinal()
    expect(render).toHaveBeenCalledOnce()

    scheduler.schedulePartial()
    expect(render).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(149)
    expect(render).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1)
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('default window is 150ms when not specified', () => {
    const render = vi.fn()
    const scheduler = createRenderScheduler({ render })
    scheduler.schedulePartial()
    vi.advanceTimersByTime(149)
    expect(render).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(render).toHaveBeenCalledOnce()
  })

  it('uses injected setTimeout / clearTimeout when provided (no global timer dependency)', () => {
    const fakeSet = vi.fn(() => 42 as unknown as ReturnType<typeof setTimeout>)
    const fakeClear = vi.fn()
    const render = vi.fn()
    const scheduler = createRenderScheduler({
      render,
      windowMs: 100,
      setTimeoutImpl: fakeSet as unknown as typeof setTimeout,
      clearTimeoutImpl: fakeClear,
    })
    scheduler.schedulePartial()
    expect(fakeSet).toHaveBeenCalledWith(expect.any(Function), 100)
    scheduler.cancel()
    expect(fakeClear).toHaveBeenCalledWith(42)
  })
})
