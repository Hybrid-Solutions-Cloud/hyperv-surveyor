import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_CONFIG, defaultTiers, demoFleet } from './defaults'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'

interface SurveyorState {
  customerName: string
  vms: Vm[]
  cfg: ClusterConfig
  tiers: Record<TierId, TierPolicy>
  chosenKey: string
  setCustomerName: (name: string) => void
  setVms: (vms: Vm[]) => void
  setCfg: (cfg: ClusterConfig) => void
  setTiers: (tiers: Record<TierId, TierPolicy>) => void
  setChosenKey: (key: string) => void
  loadScenario: (scenario: {
    customerName?: string
    vms?: Vm[]
    cfg: ClusterConfig
    tiers: Record<TierId, TierPolicy>
  }) => void
  loadDemo: () => void
  resetScenario: () => void
}

const defaults = () => ({
  customerName: '',
  vms: [] as Vm[],
  cfg: structuredClone(DEFAULT_CONFIG),
  tiers: defaultTiers(),
  chosenKey: 'san',
})

export const useSurveyorStore = create<SurveyorState>()(
  persist(
    (set) => ({
      ...defaults(),
      setCustomerName: (customerName) => set({ customerName }),
      setVms: (vms) => set({ vms }),
      setCfg: (cfg) => set({ cfg }),
      setTiers: (tiers) => set({ tiers }),
      setChosenKey: (chosenKey) => set({ chosenKey }),
      loadScenario: (scenario) => set({
        customerName: scenario.customerName ?? '',
        vms: scenario.vms ?? [],
        cfg: scenario.cfg,
        tiers: scenario.tiers,
      }),
      loadDemo: () => set({ vms: demoFleet() }),
      resetScenario: () => set(defaults()),
    }),
    {
      name: 'hyperv-surveyor-state',
      version: 1,
      partialize: (state) => ({
        customerName: state.customerName,
        cfg: state.cfg,
        tiers: state.tiers,
        chosenKey: state.chosenKey,
        // Large customer inventories belong in an exported scenario file. Keeping the
        // common case makes refreshes friendly without exhausting localStorage.
        vms: state.vms.length <= 2_000 ? state.vms : [],
      }),
    },
  ),
)
