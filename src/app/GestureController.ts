import type { ClientLogger } from '../observability/clientLogger'

/**
 * Gesture inputs from the wearable surface — Even Realities Ring and the
 * G2 glasses temples. The SDK routes ring/temple touches through whichever
 * lens container has `isEventCapture: 1`. For us that's the caption text
 * container (`g2LensDisplay.ts`), so the events arrive as
 * `event.textEvent` with an `eventType` of CLICK / DOUBLE_CLICK / SCROLL.
 *
 * Implementation note (corrected from an earlier mistaken design): the
 * `sysEvent.eventSource` field that distinguishes ring vs glasses-L vs
 * glasses-R is only populated for system-level events (IMU streams,
 * foreground enter/exit). Normal taps on a text or list container
 * arrive as `textEvent` / `listEvent`, which carry the eventType but
 * no source label. So we route by eventType only, and report the
 * source as 'capture-target' (the caption container) — we can't
 * differentiate ring from temple at the SDK layer.
 *
 * Phase 1 wires single-tap (CLICK) and double-tap (DOUBLE_CLICK) only.
 * Scroll gestures are routed through but no-op until Phase 2 (caption
 * history backbuffer + scroll-into-view rendering on the lens).
 */

/** OS event types we react to, from the SDK's `OsEventTypeList` enum. */
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
  textEvent?: {
    containerID?: number
    containerName?: string
    eventType?: number
  }
  listEvent?: {
    containerID?: number
    containerName?: string
    eventType?: number
    currentSelectItemIndex?: number
    currentSelectItemName?: string
  }
  sysEvent?: {
    eventType?: number
    eventSource?: number
  }
}

export type GestureSource = 'ring' | 'glasses-left' | 'glasses-right' | 'capture-target' | 'unknown'

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
    // Diagnostic: log any non-audio event the bridge emits so we can verify
    // ring/temple events reach the WebView and see the actual shape on
    // hardware. Audio events fire ~10/s and would drown the logs, so they
    // get filtered out at the source.
    if (event.textEvent || event.listEvent || event.sysEvent) {
      this.options.logger.stage('gesture_raw_event', {
        kind: event.textEvent ? 'text' : event.listEvent ? 'list' : 'sys',
        textEventType: event.textEvent?.eventType ?? null,
        textContainerID: event.textEvent?.containerID ?? null,
        listEventType: event.listEvent?.eventType ?? null,
        listContainerID: event.listEvent?.containerID ?? null,
        sysEventType: event.sysEvent?.eventType ?? null,
        sysEventSource: event.sysEvent?.eventSource ?? null,
      })
    }

    // Primary path: textEvent / listEvent on the focused capture target.
    // This is how ring + temple taps land in apps that use a lens text
    // container (which we do — see g2LensDisplay's isEventCapture: 1).
    const eventType = event.textEvent?.eventType ?? event.listEvent?.eventType ?? event.sysEvent?.eventType
    if (eventType === undefined) return

    const source = this.deriveSource(event)
    this.dispatch(eventType, source)
  }

  private deriveSource(event: GestureBridgeEvent): GestureSource {
    // sysEvent carries explicit eventSource info when available; prefer it.
    const sysSource = event.sysEvent?.eventSource
    if (sysSource === 1) return 'glasses-right'
    if (sysSource === 2) return 'ring'
    if (sysSource === 3) return 'glasses-left'
    // textEvent / listEvent don't carry source info — the SDK only
    // identifies the container that received the input. Report this as
    // 'capture-target' so callers know it came from a focused container,
    // just not which physical input produced it.
    if (event.textEvent || event.listEvent) return 'capture-target'
    return 'unknown'
  }

  private dispatch(eventType: number, source: GestureSource): void {
    switch (eventType) {
      case TAP_EVENT_TYPES.click:
        this.options.logger.stage('gesture_single_tap', { source })
        this.options.onSingleTap(source)
        return
      case TAP_EVENT_TYPES.doubleClick:
        this.options.logger.stage('gesture_double_tap', { source })
        this.options.onDoubleTap(source)
        return
      case TAP_EVENT_TYPES.scrollTop:
        this.options.logger.stage('gesture_scroll_up', { source })
        this.options.onScrollUp?.(source)
        return
      case TAP_EVENT_TYPES.scrollBottom:
        this.options.logger.stage('gesture_scroll_down', { source })
        this.options.onScrollDown?.(source)
        return
      default:
        // Foreground enter/exit (4/5), abnormal/system exit (6/7), IMU
        // report (8) — not user input gestures.
        this.options.logger.stage('gesture_event_type_unrecognized', { source, eventType })
    }
  }
}
