import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'

export const G2_CAPTION_CONTAINER_ID = 1
export const G2_CAPTION_CONTAINER_NAME = 'g2-caption-main'

export interface G2CaptionBridge {
  createStartUpPageContainer(container: CreateStartUpPageContainer): Promise<number | string>
  textContainerUpgrade(container: TextContainerUpgrade): Promise<boolean>
}

export type G2DisplayResult =
  | { ok: true }
  | { ok: false; visualStatus: string }

export function createCaptionTextContainer(content: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
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
    if (!this.started) {
      const result = await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({
          containerTotalNum: 1,
          textObject: [createCaptionTextContainer(content)],
        }),
      )

      if (!startupSucceeded(result)) {
        return { ok: false, visualStatus: 'G2 DISPLAY FAILED — startup rejected' }
      }

      this.started = true
      return { ok: true }
    }

    const ok = await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: G2_CAPTION_CONTAINER_ID,
        containerName: G2_CAPTION_CONTAINER_NAME,
        contentOffset: 0,
        contentLength: content.length,
        content,
      }),
    )

    if (!ok) {
      return { ok: false, visualStatus: 'G2 DISPLAY FAILED — caption update failed' }
    }

    return { ok: true }
  }
}
