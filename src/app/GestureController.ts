import type { ClientLogger } from '../observability/clientLogger'

/**
 * Gesture inputs from the wearable surface — Even Realities Ring and the
 * G2 glasses temples. Both speak the same vocabulary in the SDK: a
 * `Sys_ItemEvent` with `eventType` (CLICK / DOUBLE_CLICK / SCROLL_TOP /
 * SCROLL_BOTTOM) and `eventSource` (RING / GLASSES_R / GLASSES_L).
 *
 * Phase 1 wires single-tap (CLICK) and double-tap (DOUBLE_CLICK) only.
 * Scroll gestures are routed through but no-op until Phase 2 (caption
 * history backbuffer + scroll-into-view rendering on the lens).
 */

/** Sources we treat as "wearable input" (the user's hand/head). */
export const WEARABLE_INPUT_SOURCES = new Set<number>([
  // EventSourceType enum values from @evenrealities/even_hub_sdk:
  //   1 = TOUCH_EVENT_FROM_GLASSES_R
  //   2 = TOUCH_EVENT_FROM_RING
  //   3 = TOUCH_EVENT_FROM_GLASSES_L
  1, 2, 3,
])

/** OS event types we react to, again from the SDK enum. */
export const TAP_EVENT_TYPES = {
  click: 0,
  scrollTop: 1,
  scrollBottom: 2,
  doubleClick: 3,
} as const

/**
 * Minimal shape of the bridge subscription we depend on. Mirrors the
 * SDK's `EvenAppBridge.onEvenHubEvent`, but typed loose so unit tests
 * can drive the controller with a fake bridge that doesn't import the
 * SDK runtime.
 */
export interface GestureBridge {
  onEvenHubEvent(callback: (event: GestureBridgeEvent) => void): () => void
}

export interface GestureBridgeEvent {
  sysEvent?: {
    eventType?: number
    eventSource?: number
  }
}

export type GestureSource = 'ring' | 'glasses-left' | 'glasses-right' | 'unknown'

export interface GestureControllerOptions {
  bridge: GestureBridge
  logger: ClientLogger
  onSingleTap: (source: GestureSource) => void
  onDoubleTap: (source: GestureSource) => void
  onScrollUp?: (source: GestureSource) => void
  onScrollDown?: (source: GestureSource) => void
}

export class GestureController {
  private unsubscribe: (() => void) | undefined
  private readonly options: GestureControllerOptions

  constructor(options: GestureControllerOptions) {
    this.options = options
    this.unsubscribe = options.bridge.onEvenHubEvent((event) => this.handleEvent(event))
    this.options.logger.stage('gesture_controller_subscribed')
  }

  /** Called from main.ts on app teardown / hot-reload. */
  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  private handleEvent(event: GestureBridgeEvent): void {
    const sys = event.sysEvent
    if (!sys) return
    const source = sys.eventSource
    if (source === undefined || !WEARABLE_INPUT_SOURCES.has(source)) return

    const sourceLabel = labelSource(source)
    const eventType = sys.eventType

    switch (eventType) {
      case TAP_EVENT_TYPES.click:
        this.options.logger.stage('gesture_single_tap', { source: sourceLabel })
        this.options.onSingleTap(sourceLabel)
        return
      case TAP_EVENT_TYPES.doubleClick:
        this.options.logger.stage('gesture_double_tap', { source: sourceLabel })
        this.options.onDoubleTap(sourceLabel)
        return
      case TAP_EVENT_TYPES.scrollTop:
        this.options.logger.stage('gesture_scroll_up', { source: sourceLabel })
        this.options.onScrollUp?.(sourceLabel)
        return
      case TAP_EVENT_TYPES.scrollBottom:
        this.options.logger.stage('gesture_scroll_down', { source: sourceLabel })
        this.options.onScrollDown?.(sourceLabel)
        return
      default:
      // Other OsEventTypeList values (foreground enter/exit, IMU report,
      // system exit) aren't user input gestures — ignore.
    }
  }
}

function labelSource(source: number): GestureSource {
  switch (source) {
    case 1:
      return 'glasses-right'
    case 2:
      return 'ring'
    case 3:
      return 'glasses-left'
    default:
      return 'unknown'
  }
}
