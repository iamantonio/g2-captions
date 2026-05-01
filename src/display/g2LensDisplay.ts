import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'

export const G2_CAPTION_CONTAINER_ID = 1
export const G2_CAPTION_CONTAINER_NAME = 'g2-caption-main'
export const G2_STARTUP_CONTENT = 'G2 CAPTIONS\nSTARTING'

export interface G2CaptionBridge {
  createStartUpPageContainer(container: CreateStartUpPageContainer): Promise<number | string>
  textContainerUpgrade(container: TextContainerUpgrade): Promise<boolean>
  rebuildPageContainer?(container: RebuildPageContainer): Promise<boolean>
}

export type G2DisplayResult = { ok: true } | { ok: false; visualStatus: string }

export function sanitizeG2LensText(content: string): string {
  // Strip everything outside the G2 lens's ASCII printable + LF/CR range.
  // The control-char escape is intentional \u2014 eslint-disable applies only here.
  return (
    content
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x0A\x0D\x20-\x7E]/g, '')
  )
}

export function createCaptionTextContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 8,
    yPosition: 8,
    width: 560,
    height: 272,
    borderWidth: 0,
    borderColor: 5,
    borderRadius: 0,
    paddingLength: 0,
    containerID: G2_CAPTION_CONTAINER_ID,
    containerName: G2_CAPTION_CONTAINER_NAME,
    content,
    isEventCapture: 1,
  })
}

function startupSucceeded(result: number | string): boolean {
  return result === 0 || result === '0' || result === 'APP_REQUEST_CREATE_PAGE_SUCCESS'
}

export class G2LensDisplay {
  private started = false

  constructor(private readonly bridge: G2CaptionBridge | EvenAppBridge) {}

  async render(content: string): Promise<G2DisplayResult> {
    const lensContent = sanitizeG2LensText(content)
    if (!this.started) {
      const result = await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 1,
          textObject: [createCaptionTextContainer(G2_STARTUP_CONTENT)],
        }),
      )

      if (!startupSucceeded(result)) {
        return { ok: false, visualStatus: `G2 DISPLAY FAILED — startup rejected (${String(result)})` }
      }

      this.started = true
    }

    const ok = await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: G2_CAPTION_CONTAINER_ID,
        containerName: G2_CAPTION_CONTAINER_NAME,
        contentOffset: 0,
        contentLength: lensContent.length,
        content: lensContent,
      }),
    )

    if (!ok) {
      const rebuildOk = await this.rebuild(lensContent)
      if (rebuildOk) return { ok: true }
      return { ok: false, visualStatus: 'G2 DISPLAY FAILED — caption update failed' }
    }

    return { ok: true }
  }

  private async rebuild(content: string): Promise<boolean> {
    if (!('rebuildPageContainer' in this.bridge) || typeof this.bridge.rebuildPageContainer !== 'function') {
      return false
    }

    return this.bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [createCaptionTextContainer(content)],
      }),
    )
  }
}
