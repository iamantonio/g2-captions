import { describe, expect, it, vi } from 'vitest'
import { G2_CAPTION_CONTAINER_ID, G2_CAPTION_CONTAINER_NAME, createCaptionTextContainer, G2LensDisplay } from '../../src/display/g2LensDisplay'

describe('G2 lens caption display', () => {
  it('creates one full-screen text capture container for captions', () => {
    const container = createCaptionTextContainer('G2 CAPTIONS\nREADY')

    expect(container.containerID).toBe(G2_CAPTION_CONTAINER_ID)
    expect(container.containerName).toBe(G2_CAPTION_CONTAINER_NAME)
    expect(container.xPosition).toBe(0)
    expect(container.yPosition).toBe(0)
    expect(container.width).toBe(576)
    expect(container.height).toBe(288)
    expect(container.isEventCapture).toBe(1)
    expect(container.content).toBe('G2 CAPTIONS\nREADY')
  })

  it('creates the startup page once and then upgrades text for caption changes', async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn().mockResolvedValue(0),
      textContainerUpgrade: vi.fn().mockResolvedValue(true),
    }
    const display = new G2LensDisplay(bridge)

    await display.render('G2 CAPTIONS\nREADY')
    await display.render('G2 CAPTIONS\nA: hello')

    expect(bridge.createStartUpPageContainer).toHaveBeenCalledTimes(1)
    const startup = bridge.createStartUpPageContainer.mock.calls[0][0]
    expect(startup.containerTotalNum).toBe(1)
    expect(startup.textObject).toHaveLength(1)
    expect(startup.textObject[0].content).toBe('G2 CAPTIONS\nREADY')

    expect(bridge.textContainerUpgrade).toHaveBeenCalledTimes(1)
    const upgrade = bridge.textContainerUpgrade.mock.calls[0][0]
    expect(upgrade.containerID).toBe(G2_CAPTION_CONTAINER_ID)
    expect(upgrade.containerName).toBe(G2_CAPTION_CONTAINER_NAME)
    expect(upgrade.content).toBe('G2 CAPTIONS\nA: hello')
  })

  it('returns a visual failure status when the startup container is rejected', async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn().mockResolvedValue(2),
      textContainerUpgrade: vi.fn().mockResolvedValue(true),
    }
    const display = new G2LensDisplay(bridge)

    const result = await display.render('G2 CAPTIONS\nREADY')

    if (result.ok !== false) throw new Error('expected startup failure')
    expect(result.visualStatus).toBe('G2 DISPLAY FAILED — startup rejected')
    expect(bridge.textContainerUpgrade).not.toHaveBeenCalled()
  })

  it('returns a visual failure status when a text upgrade fails', async () => {
    const bridge = {
      createStartUpPageContainer: vi.fn().mockResolvedValue(0),
      textContainerUpgrade: vi.fn().mockResolvedValue(false),
    }
    const display = new G2LensDisplay(bridge)

    await display.render('G2 CAPTIONS\nREADY')
    const result = await display.render('G2 CAPTIONS\nA: hello')

    if (result.ok !== false) throw new Error('expected update failure')
    expect(result.visualStatus).toBe('G2 DISPLAY FAILED — caption update failed')
  })
})
