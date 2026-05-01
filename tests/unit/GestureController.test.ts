import { describe, expect, it, vi } from 'vitest'
import {
  GestureController,
  TAP_EVENT_TYPES,
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

  it('routes textEvent CLICK_EVENT to onSingleTap (the path used when the lens caption container is the focused capture target)', () => {
    const bridge = makeFakeBridge()
    const onSingleTap = vi.fn()
    new GestureController({ bridge, logger: makeLogger(), onSingleTap, onDoubleTap: vi.fn() })

    bridge.emit({ textEvent: { eventType: TAP_EVENT_TYPES.click, containerID: 1 } })
    expect(onSingleTap).toHaveBeenCalledWith('capture-target')
  })

  it('routes textEvent DOUBLE_CLICK_EVENT to onDoubleTap', () => {
    const bridge = makeFakeBridge()
    const onDoubleTap = vi.fn()
    new GestureController({ bridge, logger: makeLogger(), onSingleTap: vi.fn(), onDoubleTap })

    bridge.emit({ textEvent: { eventType: TAP_EVENT_TYPES.doubleClick, containerID: 1 } })
    expect(onDoubleTap).toHaveBeenCalledWith('capture-target')
  })

  it('routes listEvent CLICK_EVENT the same way (in case a future surface adds a list container)', () => {
    const bridge = makeFakeBridge()
    const onSingleTap = vi.fn()
    new GestureController({ bridge, logger: makeLogger(), onSingleTap, onDoubleTap: vi.fn() })

    bridge.emit({ listEvent: { eventType: TAP_EVENT_TYPES.click, containerID: 2 } })
    expect(onSingleTap).toHaveBeenCalledWith('capture-target')
  })

  it('reports source = ring when the SDK includes sysEvent.eventSource (system-level path)', () => {
    const bridge = makeFakeBridge()
    const onSingleTap = vi.fn()
    new GestureController({ bridge, logger: makeLogger(), onSingleTap, onDoubleTap: vi.fn() })

    bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.click, eventSource: 2 } }) // RING
    expect(onSingleTap).toHaveBeenCalledWith('ring')
  })

  it('reports source = glasses-right / glasses-left from sysEvent.eventSource', () => {
    const bridge = makeFakeBridge()
    const onSingleTap = vi.fn()
    new GestureController({ bridge, logger: makeLogger(), onSingleTap, onDoubleTap: vi.fn() })

    bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.click, eventSource: 1 } }) // GLASSES_R
    expect(onSingleTap).toHaveBeenCalledWith('glasses-right')
    bridge.emit({ sysEvent: { eventType: TAP_EVENT_TYPES.click, eventSource: 3 } }) // GLASSES_L
    expect(onSingleTap).toHaveBeenCalledWith('glasses-left')
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

    bridge.emit({ textEvent: { eventType: TAP_EVENT_TYPES.scrollTop, containerID: 1 } })
    expect(onScrollUp).toHaveBeenCalledWith('capture-target')
    bridge.emit({ textEvent: { eventType: TAP_EVENT_TYPES.scrollBottom, containerID: 1 } })
    expect(onScrollDown).toHaveBeenCalledWith('capture-target')
  })

  it('drops scroll events safely when no scroll handler is wired (Phase 1 default)', () => {
    const bridge = makeFakeBridge()
    new GestureController({
      bridge,
      logger: makeLogger(),
      onSingleTap: vi.fn(),
      onDoubleTap: vi.fn(),
    })
    expect(() => bridge.emit({ textEvent: { eventType: TAP_EVENT_TYPES.scrollTop, containerID: 1 } })).not.toThrow()
  })

  it('ignores audio-only events (those have no textEvent / listEvent / sysEvent)', () => {
    const bridge = makeFakeBridge()
    const onSingleTap = vi.fn()
    new GestureController({ bridge, logger: makeLogger(), onSingleTap, onDoubleTap: vi.fn() })

    bridge.emit({}) // empty payload
    expect(onSingleTap).not.toHaveBeenCalled()
  })

  it('logs a raw_event line for every text/list/sys event so hardware-smoke logs reveal the shape the SDK actually emits', () => {
    const bridge = makeFakeBridge()
    const logger = makeLogger()
    new GestureController({ bridge, logger, onSingleTap: vi.fn(), onDoubleTap: vi.fn() })

    bridge.emit({ textEvent: { eventType: TAP_EVENT_TYPES.click, containerID: 1, containerName: 'g2-caption-main' } })
    expect(logger.stage).toHaveBeenCalledWith(
      'gesture_raw_event',
      expect.objectContaining({
        kind: 'text',
        textEventType: 0,
        textContainerID: 1,
      }),
    )
  })

  it('logs unrecognized event types so we can see what the SDK sends besides click/double-click/scroll', () => {
    const bridge = makeFakeBridge()
    const logger = makeLogger()
    new GestureController({ bridge, logger, onSingleTap: vi.fn(), onDoubleTap: vi.fn() })

    // OsEventTypeList: 4=FOREGROUND_ENTER, 5=FOREGROUND_EXIT, 8=IMU_DATA_REPORT
    bridge.emit({ sysEvent: { eventType: 8, eventSource: 2 } })
    expect(logger.stage).toHaveBeenCalledWith(
      'gesture_event_type_unrecognized',
      expect.objectContaining({ eventType: 8, source: 'ring' }),
    )
  })
})
