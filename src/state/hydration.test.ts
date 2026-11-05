import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * B6 and G13: the app renders only after prepareStore settles. These tests use slow, asynchronous
 * saved state, as IndexedDB is in a browser.
 */
describe('B6 hydration gate', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('./persistence')
  })

  async function loadWithSavedState(saved: Record<string, unknown>) {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.doMock('./persistence', () => ({
      surveyorStorage: {
        getItem: async () => { await gate; return JSON.stringify({ state: saved, version: 6 }) },
        setItem: async () => undefined,
        removeItem: async () => undefined,
      },
    }))
    const store = await import('./store')
    return { ...store, release }
  }

  it('applies a shared link after saved state loads, so the saved state cannot overwrite it', async () => {
    const { prepareStore, useSurveyorStore, release } = await loadWithSavedState({ customerName: 'Local', engagementMode: 'fit-gap' })
    const shared = { customerName: 'Shared', engagementMode: 'new-platform' as const, cfg: useSurveyorStore.getState().cfg, tiers: useSurveyorStore.getState().tiers, vms: [] }
    let ready = false
    const preparing = prepareStore(shared).then(() => { ready = true })
    await Promise.resolve()
    expect(ready).toBe(false)
    release()
    await preparing
    expect(useSurveyorStore.getState().customerName).toBe('Shared')
    expect(useSurveyorStore.getState().engagementMode).toBe('new-platform')
  })

  it('G13: report selections computed after the gate follow the saved path', async () => {
    const { prepareStore, useSurveyorStore, release } = await loadWithSavedState({ engagementMode: 'management-only' })
    const { defaultReportSelection } = await import('../report/reportModel')
    // Before hydration the store still holds defaults; nothing renders then.
    expect(useSurveyorStore.getState().engagementMode).toBeNull()
    release()
    await prepareStore(null)
    const selection = defaultReportSelection(useSurveyorStore.getState().engagementMode)
    expect(Object.entries(selection).filter(([, on]) => on).map(([id]) => id).sort()).toEqual(['executive', 'management', 'sources'])
  })

  it('settles even when reading saved state fails', async () => {
    vi.doMock('./persistence', () => ({
      surveyorStorage: { getItem: async () => { throw new Error('blocked') }, setItem: async () => undefined, removeItem: async () => undefined },
    }))
    const { prepareStore } = await import('./store')
    await expect(prepareStore(null)).resolves.toBeUndefined()
  })
})
