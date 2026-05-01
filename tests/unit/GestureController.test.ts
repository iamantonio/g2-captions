import { describe, expect, it, vi } from 'vitest'
import {
  GestureController,
  TAP_EVENT_TYPES,
  WEARABLE_INPUT_SOURCES,
  type GestureBridge,
  type GestureBridgeEvent,
} from '../../src/app/GestureController'
import type { ClientLogger } from '../../src/observability/clientLogger'

interface FakeBridge extends GestureBridge {
  emit(event: GestureBridgeEvent): void
  unsubscribed: boolean
}

function makeFakeBridge(): FakeBridge {
  let listener: ((event: GestureBridgeEvent) => void) | undefined
  return {
    onEvenHubEvent(callback) {
      listener = callback
      return () => {
        listener = undefined
      }
    },
    emit(event: GestureBridgeEvent) {
      listener?.(event)
    },
    get unsubscribed() {
      return listener === undefined
    },
  } as FakeBridge
}

function makeLogger(): ClientLogger & {
  stage: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
} {
  return { stage: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const RING_SOURCE = 2
const GLASSES_RIGHT_SOURCE = 1
const GLASSES_LEFT_SOURCE = 3

describe('GestureController', () => {
  it('subscribes to bridge events on construction and unsubscribes on dispose()', () => {
    const bridge = makeFakeBridge()
    const ctl = new GestureController({
      bridge,
      logger: makeLogger(),
      onSingleTap: vi.fn(),
      onDoubleTap: vi.fn(),
    })
    expect(bridge.unsubscribed).toBe(false)
    ctl.dispose()
    expect(bridge.unsubscribed).toBe(true)
  })

  it('routes ring CLICK_EVENT to onSingleTap with source=ring', () => {
    const bridge = makeFakeBridge()
    const onSingleTap = vi.fn()
    new GestureController({ bridge, logger: makeLogger(), onSingleTap, onDoubleTap: vi.fn() })

    bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.click, eventSource: RING_SOURCE } })
    expect(onSingleTap).toHaveBeenCalledWith('ring')
  })

  it('routes ring DOUBLE_CLICK_EVENT to onDoubleTap', () => {
    const bridge = makeFakeBridge()
    const onDoubleTap = vi.fn()
    new GestureController({ bridge, logger: makeLogger(), onSingleTap: vi.fn(), onDoubleTap })

    bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.doubleClick, eventSource: RING_SOURCE } })
    expect(onDoubleTap).toHaveBeenCalledWith('ring')
  })

  it('treats both glasses temples as wearable input alongside the ring', () => {
    const bridge = makeFakeBridge()
    const onSingleTap = vi.fn()
    new GestureController({ bridge, logger: makeLogger(), onSingleTap, onDoubleTap: vi.fn() })

    bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.click, eventSource: GLASSES_RIGHT_SOURCE } })
    expect(onSingleTap).toHaveBeenCalledWith('glasses-right')
    bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.click, eventSource: GLASSES_LEFT_SOURCE } })
    expect(onSingleTap).toHaveBeenCalledWith('glasses-left')
    expect(onSingleTap).toHaveBeenCalledTimes(2)
  })

  it('ignores events whose eventSource is not a wearable input', () => {
    const bridge = makeFakeBridge()
    const onSingleTap = vi.fn()
    new GestureController({ bridge, logger: makeLogger(), onSingleTap, onDoubleTap: vi.fn() })

    bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.click, eventSource: 0 } }) // DUMMY_NULL
    bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.click, eventSource: 99 } }) // unknown
    bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.click } }) // missing source
    expect(onSingleTap).not.toHaveBeenCalled()
  })

  it('ignores non-tap event types like FOREGROUND_ENTER and IMU_DATA_REPORT', () => {
    const bridge = makeFakeBridge()
    const onSingleTap = vi.fn()
    const onDoubleTap = vi.fn()
    new GestureController({ bridge, logger: makeLogger(), onSingleTap, onDoubleTap })

    bridge.emit({ sysEvent: { eventType: 4, eventSource: RING_SOURCE } }) // FOREGROUND_ENTER
    bridge.emit({ sysEvent: { eventType: 5, eventSource: RING_SOURCE } }) // FOREGROUND_EXIT
    bridge.emit({ sysEvent: { eventType: 8, eventSource: RING_SOURCE } }) // IMU_DATA_REPORT
    expect(onSingleTap).not.toHaveBeenCalled()
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('routes scroll gestures only when handlers are provided', () => {
    const bridge = makeFakeBridge()
    const onScrollUp = vi.fn()
    const onScrollDown = vi.fn()
    new GestureController({
      bridge,
      logger: makeLogger(),
      onSingleTap: vi.fn(),
      onDoubleTap: vi.fn(),
      onScrollUp,
      onScrollDown,
    })

    bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.scrollTop, eventSource: RING_SOURCE } })
    expect(onScrollUp).toHaveBeenCalledWith('ring')
    bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.scrollBottom, eventSource: RING_SOURCE } })
    expect(onScrollDown).toHaveBeenCalledWith('ring')
  })

  it('drops scroll events safely when no scroll handler is wired (Phase 1 default)', () => {
    const bridge = makeFakeBridge()
    new GestureController({
      bridge,
      logger: makeLogger(),
      onSingleTap: vi.fn(),
      onDoubleTap: vi.fn(),
    })
    expect(() =>
      bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.scrollTop, eventSource: RING_SOURCE } }),
    ).not.toThrow()
  })

  it('logs every dispatched gesture with source label so hardware-smoke logs can verify ring usage', () => {
    const bridge = makeFakeBridge()
    const logger = makeLogger()
    new GestureController({ bridge, logger, onSingleTap: vi.fn(), onDoubleTap: vi.fn() })
    bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.click, eventSource: RING_SOURCE } })
    expect(logger.stage).toHaveBeenCalledWith('gesture_single_tap', { source: 'ring' })
  })

  it('exports the wearable-source allowlist as a Set for external introspection', () => {
    expect(WEARABLE_INPUT_SOURCES.has(1)).toBe(true)
    expect(WEARABLE_INPUT_SOURCES.has(2)).toBe(true)
    expect(WEARABLE_INPUT_SOURCES.has(3)).toBe(true)
    expect(WEARABLE_INPUT_SOURCES.has(0)).toBe(false)
  })
})
