import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_CONFIG, DEFAULT_PROPOSED_CONFIG, defaultTiers, demoFleet } from './defaults'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'
import type { ManagementDeploymentInputs } from '../engine/managementDeployment'
import type { ImportSummary } from '../io/rvtools'
import type { StorageDecisionAnswers } from '../engine/storageDecision'
import { DEFAULT_REPORT_METADATA, normalizeConfig, normalizeProjectPayload, normalizeProposedConfig, normalizeStorageDecisionAnswers, normalizeTiers, type ProjectDataSource, type ProjectPayload, type ReportMetadata, type ScenarioSnapshot } from './project'
import { surveyorStorage } from './persistence'
import { DEFAULT_PLACEMENT_INPUTS, normalizePlacementInputs, type PlacementInputs } from '../engine/deploymentPlanning'
import { DEFAULT_NETWORK_INPUTS, type NetworkDesignInputs } from '../engine/networkDesign'
import { DEFAULT_DR_INPUTS, type DrDesignInputs } from '../engine/drDesign'
import { normalizeEngagementMode, normalizeManagementDecision, type EngagementMode, type ManagementDecision } from './journey'

export interface SurveyorState {
  engagementMode: EngagementMode | null
  managementDecision: ManagementDecision
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
  /** The last RVTools import's counts and warnings, kept so they survive leaving the page. */
  lastImport: ImportSummary | null
  setLastImport: (summary: ImportSummary | null) => void
  storageDecisionAnswers: StorageDecisionAnswers
  setStorageDecisionAnswers: (answers: StorageDecisionAnswers) => void
  setEngagementMode: (mode: EngagementMode | null) => void
  setManagementDecision: (decision: ManagementDecision) => void
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
    engagementMode?: EngagementMode | null
    managementDecision?: ManagementDecision
    customerName?: string
    vms?: Vm[]
    cfg: ClusterConfig
    tiers: Record<TierId, TierPolicy>
    inventoryOmitted?: number
    existingCapacityCfg?: ClusterConfig
    existingCapacityTiers?: Record<TierId, TierPolicy>
    existingCapacityNodes?: number
  }) => void
  loadDemo: () => void
  resetScenario: () => void
}

const defaults = () => ({
  engagementMode: null as EngagementMode | null,
  managementDecision: 'unassessed' as ManagementDecision,
  customerName: '',
  vms: [] as Vm[],
  cfg: structuredClone(DEFAULT_PROPOSED_CONFIG),
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
  lastImport: null as ImportSummary | null,
  storageDecisionAnswers: {} as StorageDecisionAnswers,
})

function payloadFromState(state: SurveyorState): ProjectPayload {
  return {
    engagementMode: state.engagementMode,
    managementDecision: state.managementDecision,
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
    storageDecisionAnswers: structuredClone(state.storageDecisionAnswers),
  }
}

export const useSurveyorStore = create<SurveyorState>()(
  persist(
    (set) => ({
      ...defaults(),
      setLastImport: (lastImport) => set({ lastImport }),
      setStorageDecisionAnswers: (storageDecisionAnswers) => set({ storageDecisionAnswers }),
      setEngagementMode: (engagementMode) => set({ engagementMode }),
      setManagementDecision: (managementDecision) => set({ managementDecision }),
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
      loadProject: (payload) => set({ ...normalizeProjectPayload(payload), sharedInventoryOmitted: null, lastImport: null }),
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
      loadScenario: (scenario) => set((state) => ({
        engagementMode: normalizeEngagementMode(scenario.engagementMode, scenario.vms && scenario.vms.length > 0 ? 'new-platform' : null),
        managementDecision: normalizeManagementDecision(scenario.managementDecision),
        customerName: scenario.customerName ?? '',
        vms: scenario.vms ?? [],
        cfg: normalizeProposedConfig(scenario.cfg),
        tiers: normalizeTiers(scenario.tiers),
        sharedInventoryOmitted: scenario.inventoryOmitted ?? null,
        existingCapacityCfg: scenario.existingCapacityCfg ? normalizeConfig(scenario.existingCapacityCfg) : state.existingCapacityCfg,
        existingCapacityTiers: scenario.existingCapacityTiers ? normalizeTiers(scenario.existingCapacityTiers) : state.existingCapacityTiers,
        existingCapacityNodes: typeof scenario.existingCapacityNodes === 'number' ? Math.max(1, scenario.existingCapacityNodes) : state.existingCapacityNodes,
      })),
      loadDemo: () => set({ vms: demoFleet() }),
      resetScenario: () => set(defaults()),
    }),
    {
      name: 'hyperv-surveyor-state',
      version: 5,
      storage: createJSONStorage(() => surveyorStorage),
      migrate: (persisted) => {
        const value = persisted as Partial<SurveyorState>
        return {
          ...defaults(),
          ...value,
          engagementMode: normalizeEngagementMode(value.engagementMode, Array.isArray(value.vms) && value.vms.length > 0 ? 'new-platform' : null),
          managementDecision: value.managementDecision === undefined && value.managementDeploymentInputs ? 'design' : normalizeManagementDecision(value.managementDecision),
          cfg: normalizeProposedConfig(value.cfg),
          tiers: normalizeTiers(value.tiers),
          placementInputs: normalizePlacementInputs(value.placementInputs),
          storageDecisionAnswers: normalizeStorageDecisionAnswers(value.storageDecisionAnswers),
          existingCapacityCfg: normalizeConfig(value.existingCapacityCfg),
          existingCapacityTiers: normalizeTiers(value.existingCapacityTiers),
          savedScenarios: Array.isArray(value.savedScenarios)
            ? value.savedScenarios.map((scenario) => ({ ...scenario, cfg: normalizeProposedConfig(scenario.cfg), placementInputs: normalizePlacementInputs(scenario.placementInputs) }))
            : [],
        } as SurveyorState
      },
      partialize: (state) => ({
        engagementMode: state.engagementMode,
        managementDecision: state.managementDecision,
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
        lastImport: state.lastImport,
        storageDecisionAnswers: state.storageDecisionAnswers,
        savedScenarios: state.savedScenarios,
        vms: state.vms,
      }),
    },
  ),
)
