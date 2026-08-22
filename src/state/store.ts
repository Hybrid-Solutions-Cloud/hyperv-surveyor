import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_CONFIG, defaultTiers, demoFleet } from './defaults'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'
import type { ManagementDeploymentInputs } from '../engine/managementDeployment'
import { DEFAULT_REPORT_METADATA, normalizeConfig, normalizeProjectPayload, normalizeTiers, type ProjectDataSource, type ProjectPayload, type ReportMetadata, type ScenarioSnapshot } from './project'
import { surveyorStorage } from './persistence'
import { DEFAULT_PLACEMENT_INPUTS, type PlacementInputs } from '../engine/deploymentPlanning'
import { DEFAULT_NETWORK_INPUTS, type NetworkDesignInputs } from '../engine/networkDesign'
import { DEFAULT_DR_INPUTS, type DrDesignInputs } from '../engine/drDesign'

export interface SurveyorState {
  customerName: string
  vms: Vm[]
  cfg: ClusterConfig
  tiers: Record<TierId, TierPolicy>
  chosenKey: string
  existingCapacityCfg: ClusterConfig
  existingCapacityTiers: Record<TierId, TierPolicy>
  existingCapacityNodes: number
  managementDeploymentInputs: ManagementDeploymentInputs | null
  includeManagementInSizing: boolean
  savedScenarios: ScenarioSnapshot[]
  sharedInventoryOmitted: number | null
  placementInputs: PlacementInputs
  networkDesignInputs: NetworkDesignInputs
  drDesignInputs: DrDesignInputs
  reportMetadata: ReportMetadata
  dataSources: ProjectDataSource[]
  setCustomerName: (name: string) => void
  setVms: (vms: Vm[]) => void
  setCfg: (cfg: ClusterConfig) => void
  setTiers: (tiers: Record<TierId, TierPolicy>) => void
  setChosenKey: (key: string) => void
  setExistingCapacityCfg: (cfg: ClusterConfig) => void
  setExistingCapacityTiers: (tiers: Record<TierId, TierPolicy>) => void
  setExistingCapacityNodes: (nodes: number) => void
  setManagementDeploymentInputs: (inputs: ManagementDeploymentInputs) => void
  setIncludeManagementInSizing: (include: boolean) => void
  saveNamedScenario: (name: string) => void
  loadNamedScenario: (id: string) => void
  deleteNamedScenario: (id: string) => void
  loadProject: (payload: ProjectPayload) => void
  setPlacementInputs: (inputs: PlacementInputs) => void
  setNetworkDesignInputs: (inputs: NetworkDesignInputs) => void
  setDrDesignInputs: (inputs: DrDesignInputs) => void
  setReportMetadata: (metadata: ReportMetadata) => void
  addDataSource: (source: Omit<ProjectDataSource, 'id' | 'importedAt'>) => void
  resetExistingCapacity: () => void
  loadScenario: (scenario: {
    customerName?: string
    vms?: Vm[]
    cfg: ClusterConfig
    tiers: Record<TierId, TierPolicy>
    inventoryOmitted?: number
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
  existingCapacityCfg: structuredClone(DEFAULT_CONFIG),
  existingCapacityTiers: defaultTiers(),
  existingCapacityNodes: 8,
  managementDeploymentInputs: null as ManagementDeploymentInputs | null,
  includeManagementInSizing: true,
  savedScenarios: [] as ScenarioSnapshot[],
  sharedInventoryOmitted: null as number | null,
  placementInputs: structuredClone(DEFAULT_PLACEMENT_INPUTS),
  networkDesignInputs: structuredClone(DEFAULT_NETWORK_INPUTS),
  drDesignInputs: structuredClone(DEFAULT_DR_INPUTS),
  reportMetadata: structuredClone(DEFAULT_REPORT_METADATA),
  dataSources: [] as ProjectDataSource[],
})

function payloadFromState(state: SurveyorState): ProjectPayload {
  return {
    customerName: state.customerName,
    vms: structuredClone(state.vms),
    cfg: structuredClone(state.cfg),
    tiers: structuredClone(state.tiers),
    chosenKey: state.chosenKey,
    existingCapacityCfg: structuredClone(state.existingCapacityCfg),
    existingCapacityTiers: structuredClone(state.existingCapacityTiers),
    existingCapacityNodes: state.existingCapacityNodes,
    managementDeploymentInputs: structuredClone(state.managementDeploymentInputs),
    includeManagementInSizing: state.includeManagementInSizing,
    placementInputs: structuredClone(state.placementInputs),
    networkDesignInputs: structuredClone(state.networkDesignInputs),
    drDesignInputs: structuredClone(state.drDesignInputs),
    reportMetadata: structuredClone(state.reportMetadata),
    dataSources: structuredClone(state.dataSources),
  }
}

export const useSurveyorStore = create<SurveyorState>()(
  persist(
    (set) => ({
      ...defaults(),
      setCustomerName: (customerName) => set({ customerName }),
      setVms: (vms) => set({ vms }),
      setCfg: (cfg) => set({ cfg }),
      setTiers: (tiers) => set({ tiers }),
      setChosenKey: (chosenKey) => set({ chosenKey }),
      setExistingCapacityCfg: (existingCapacityCfg) => set({ existingCapacityCfg }),
      setExistingCapacityTiers: (existingCapacityTiers) => set({ existingCapacityTiers }),
      setExistingCapacityNodes: (existingCapacityNodes) => set({ existingCapacityNodes }),
      setManagementDeploymentInputs: (managementDeploymentInputs) => set({ managementDeploymentInputs }),
      setIncludeManagementInSizing: (includeManagementInSizing) => set({ includeManagementInSizing }),
      saveNamedScenario: (name) => set((state) => {
        const snapshot: ScenarioSnapshot = {
          ...payloadFromState(state),
          id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `scenario-${Date.now()}`,
          name: name.trim() || `Scenario ${state.savedScenarios.length + 1}`,
          createdAt: new Date().toISOString(),
        }
        return { savedScenarios: [snapshot, ...state.savedScenarios] }
      }),
      loadNamedScenario: (id) => set((state) => {
        const snapshot = state.savedScenarios.find((item) => item.id === id)
        return snapshot ? { ...normalizeProjectPayload(snapshot), sharedInventoryOmitted: null } : {}
      }),
      deleteNamedScenario: (id) => set((state) => ({ savedScenarios: state.savedScenarios.filter((item) => item.id !== id) })),
      loadProject: (payload) => set({ ...normalizeProjectPayload(payload), sharedInventoryOmitted: null }),
      setPlacementInputs: (placementInputs) => set({ placementInputs }),
      setNetworkDesignInputs: (networkDesignInputs) => set({ networkDesignInputs }),
      setDrDesignInputs: (drDesignInputs) => set({ drDesignInputs }),
      setReportMetadata: (reportMetadata) => set({ reportMetadata }),
      addDataSource: (source) => set((state) => ({ dataSources: [{ ...source, id: `source-${Date.now()}`, importedAt: new Date().toISOString() }, ...state.dataSources] })),
      resetExistingCapacity: () => set({
        existingCapacityCfg: structuredClone(DEFAULT_CONFIG),
        existingCapacityTiers: defaultTiers(),
        existingCapacityNodes: 8,
      }),
      loadScenario: (scenario) => set({
        customerName: scenario.customerName ?? '',
        vms: scenario.vms ?? [],
        cfg: normalizeConfig(scenario.cfg),
        tiers: normalizeTiers(scenario.tiers),
        sharedInventoryOmitted: scenario.inventoryOmitted ?? null,
      }),
      loadDemo: () => set({ vms: demoFleet() }),
      resetScenario: () => set(defaults()),
    }),
    {
      name: 'hyperv-surveyor-state',
      version: 3,
      storage: createJSONStorage(() => surveyorStorage),
      migrate: (persisted) => {
        const value = persisted as Partial<SurveyorState>
        return {
          ...defaults(),
          ...value,
          cfg: normalizeConfig(value.cfg),
          tiers: normalizeTiers(value.tiers),
          existingCapacityCfg: normalizeConfig(value.existingCapacityCfg),
          existingCapacityTiers: normalizeTiers(value.existingCapacityTiers),
          savedScenarios: Array.isArray(value.savedScenarios) ? value.savedScenarios : [],
        } as SurveyorState
      },
      partialize: (state) => ({
        customerName: state.customerName,
        cfg: state.cfg,
        tiers: state.tiers,
        chosenKey: state.chosenKey,
        existingCapacityCfg: state.existingCapacityCfg,
        existingCapacityTiers: state.existingCapacityTiers,
        existingCapacityNodes: state.existingCapacityNodes,
        managementDeploymentInputs: state.managementDeploymentInputs,
        includeManagementInSizing: state.includeManagementInSizing,
        placementInputs: state.placementInputs,
        networkDesignInputs: state.networkDesignInputs,
        drDesignInputs: state.drDesignInputs,
        reportMetadata: state.reportMetadata,
        dataSources: state.dataSources,
        savedScenarios: state.savedScenarios,
        vms: state.vms,
      }),
    },
  ),
)
