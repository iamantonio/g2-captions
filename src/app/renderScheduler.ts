export interface RenderScheduler {
  /**
   * Request a re-render for a partial transcript. Multiple calls inside the
   * same window collapse to one render, scheduled `windowMs` after the
   * first call. Bounded delay (one render per window) instead of pure
   * trailing-edge debounce so that continuous speech still updates the
   * lens at a steady rate instead of starving forever.
   */
  schedulePartial(): void
  /**
   * Render synchronously and cancel any pending partial render. Use for
   * final transcripts so the caption locks in immediately.
   */
  flushFinal(): void
  /** Drop any pending render without firing. Used on terminate / clear. */
  cancel(): void
  /** True iff a partial render is currently scheduled. */
  hasPending(): boolean
}

export interface RenderSchedulerOptions {
  render: () => void
  /** Throttle window in ms. Defaults to 150ms — well under the 800ms
   * end-to-end latency budget so partials remain visibly responsive
   * while the BLE write rate stays bounded. */
  windowMs?: number
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
}

const DEFAULT_WINDOW_MS = 150

export function createRenderScheduler(options: RenderSchedulerOptions): RenderScheduler {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout
  let timer: ReturnType<typeof setTimeout> | undefined

  function clear(): void {
    if (timer === undefined) return
    clearTimeoutImpl(timer)
    timer = undefined
  }

  return {
    schedulePartial() {
      if (timer !== undefined) return
      timer = setTimeoutImpl(() => {
        timer = undefined
        options.render()
      }, windowMs)
    },
    flushFinal() {
      clear()
      options.render()
    },
    cancel: clear,
    hasPending() {
      return timer !== undefined
    },
  }
}
