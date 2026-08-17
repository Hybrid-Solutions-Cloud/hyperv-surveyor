import { beforeEach, describe, expect, it } from 'vitest'
import { useSurveyorStore } from './store'

describe('existing-capacity workspace', () => {
  beforeEach(() => {
    useSurveyorStore.getState().resetScenario()
  })

  it('keeps existing hardware independent from forward-design assumptions', () => {
    const initial = useSurveyorStore.getState()
    const forwardCores = initial.cfg.node.coresPerSocket
    const existing = {
      ...initial.existingCapacityCfg,
      node: { ...initial.existingCapacityCfg.node, coresPerSocket: 24 },
      san: { ...initial.existingCapacityCfg.san, usableTiB: 180 },
    }

    initial.setExistingCapacityCfg(existing)
    initial.setExistingCapacityNodes(5)

    const updated = useSurveyorStore.getState()
    expect(updated.existingCapacityCfg.node.coresPerSocket).toBe(24)
    expect(updated.existingCapacityCfg.san.usableTiB).toBe(180)
    expect(updated.existingCapacityNodes).toBe(5)
    expect(updated.cfg.node.coresPerSocket).toBe(forwardCores)
    expect(updated.cfg.san.usableTiB).not.toBe(180)
  })

  it('does not replace existing-capacity inputs when a forward scenario is loaded', () => {
    const initial = useSurveyorStore.getState()
    initial.setExistingCapacityNodes(6)
    initial.loadScenario({
      customerName: 'Forward design',
      cfg: { ...initial.cfg, spareNodes: 3 },
      tiers: initial.tiers,
      vms: [],
    })

    expect(useSurveyorStore.getState().existingCapacityNodes).toBe(6)
  })
})
