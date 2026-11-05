import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_CONFIG, DEFAULT_PROPOSED_CONFIG, defaultTiers, demoFleet } from './defaults'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'
import type { ManagementDeploymentInputs } from '../engine/managementDeployment'
import { summarizeImport, type ImportReport, type ImportSummary } from '../io/rvtools'
import { combineImportSummaries, mergeInventories } from '../io/inventoryMerge'
import type { StorageDecisionAnswers } from '../engine/storageDecision'
import { DEFAULT_REPORT_METADATA, normalizeConfig, normalizeManagementInputs, normalizeProjectPayload, normalizeProposedConfig, normalizeScenarioSnapshots, normalizeStorageDecisionAnswers, normalizeTiers, normalizeVms, type ProjectDataSource, type ProjectPayload, type ReportMetadata, type ScenarioSnapshot } from './project'
import { surveyorStorage } from './persistence'
import { DEFAULT_PLACEMENT_INPUTS, normalizePlacementInputs, type PlacementInputs } from '../engine/deploymentPlanning'
import { DEFAULT_NETWORK_INPUTS, type NetworkDesignInputs } from '../engine/networkDesign'
import { DEFAULT_DR_INPUTS, type DrDesignInputs } from '../engine/drDesign'
import { normalizeEngagementMode, normalizeManagementDecision, type EngagementMode, type ManagementDecision } from './journey'
import type { Scenario } from './urlState'
import { normalizeAdvisorAnswers, type AdvisorAnswers } from '../data/managementPlane'
import { optionSelection, type MatrixOption } from '../engine/optionsMatrix'
import { applyOutlierDecision } from '../engine/dataQuality'
import type { OutlierDecision } from '../engine/types'
import { DEFAULT_COST_MODEL_INPUTS, normalizeCostModelInputs, type CostModelInputs } from '../engine/licensing'
import { blankExistingHardware, existingHardwareFromImport, normalizeExistingHardware, totalHostCount, type ExistingHardware } from '../engine/existingHardware'

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
  /** Your hosts as clusters of host groups. Starts blank: nothing is invented. */
  existingHardware: ExistingHardware
  managementDeploymentInputs: ManagementDeploymentInputs | null
  /** Management Plane Advisor answers. The deployment stack follows them until the user picks it. */
  managementAdvisorAnswers: AdvisorAnswers
  includeManagementInSizing: boolean
  savedScenarios: ScenarioSnapshot[]
  /** Set when a shared link left its inventory out; the notice stays until dismissed or replaced. */
  sharedInventoryOmitted: number | null
  placementInputs: PlacementInputs
  networkDesignInputs: NetworkDesignInputs
  drDesignInputs: DrDesignInputs
  reportMetadata: ReportMetadata
  dataSources: ProjectDataSource[]
  /** The last inventory import's counts and warnings, kept so they survive leaving the page. */
  lastImport: ImportSummary | null
  setLastImport: (summary: ImportSummary | null) => void
  storageDecisionAnswers: StorageDecisionAnswers
  /** Cost Model inputs: licensing basis, editions, entitlements, rates and the report option. */
  costModel: CostModelInputs
  setCostModel: (inputs: CostModelInputs) => void
  setStorageDecisionAnswers: (answers: StorageDecisionAnswers) => void
  setEngagementMode: (mode: EngagementMode | null) => void
  setManagementDecision: (decision: ManagementDecision) => void
  setCustomerName: (name: string) => void
  setVms: (vms: Vm[]) => void
  setCfg: (cfg: ClusterConfig) => void
  setTiers: (tiers: Record<TierId, TierPolicy>) => void
  setChosenKey: (key: string) => void
  /**
   * Applies an option from the options matrix or shortlist: its storage type, server and drives. Only a
   * click calls this. Ruled-out options are refused (returns false). 'split' also selects the split
   * layout, and is only possible for an option the split view offers.
   */
  selectDesignOption: (option: MatrixOption, mode?: 'one-cluster' | 'split') => boolean
  /** Records a storage-outlier choice from the Data check page, or undoes it. */
  setOutlierDecision: (vmId: string, choice: OutlierDecision['choice'] | 'undo', capGiB?: number) => void
  setExistingCapacityCfg: (cfg: ClusterConfig) => void
  setExistingCapacityTiers: (tiers: Record<TierId, TierPolicy>) => void
  setExistingCapacityNodes: (nodes: number) => void
  /** Saves the existing hardware. Any edit from the form marks it as yours (confirmed). */
  setExistingHardware: (hardware: ExistingHardware) => void
  /** Confirms values carried over from an older project, such as ones that look like the old defaults. */
  confirmExistingHardware: () => void
  /** The VM profile for "how many more fit" and the host spec remedies add. Neither confirms the hardware. */
  setExistingVmProfile: (profile: ExistingHardware['vmProfile']) => void
  setExistingAddSpec: (groupId: string | undefined) => void
  /** Builds host groups from the imported hosts (vHost). Returns false when the import has none. */
  fillExistingHardwareFromImport: () => boolean
  setManagementDeploymentInputs: (inputs: ManagementDeploymentInputs) => void
  /** Saves advisor answers. Answering makes an unassessed management decision a design. */
  setManagementAdvisorAnswers: (answers: AdvisorAnswers) => void
  setIncludeManagementInSizing: (include: boolean) => void
  saveNamedScenario: (name: string) => void
  loadNamedScenario: (id: string) => void
  deleteNamedScenario: (id: string) => void
  /** Opens a project. Saved scenarios are replaced when the file carries them (schema 5+). */
  loadProject: (payload: ProjectPayload, savedScenarios?: ScenarioSnapshot[]) => void
  setPlacementInputs: (inputs: PlacementInputs) => void
  setNetworkDesignInputs: (inputs: NetworkDesignInputs) => void
  setDrDesignInputs: (inputs: DrDesignInputs) => void
  setReportMetadata: (metadata: ReportMetadata) => void
  addDataSource: (source: Omit<ProjectDataSource, 'id' | 'importedAt'>) => void
  /** Puts an inventory import into the project, replacing the inventory or adding to it. */
  applyImport: (mode: 'replace' | 'add', report: ImportReport, fileName: string) => void
  /** Removes every workload with its import summary and data sources. */
  clearWorkloads: () => void
  dismissSharedInventoryNotice: () => void
  resetExistingCapacity: () => void
  /** Applies a shared link. Fields the link does not carry keep their current values. */
  loadScenario: (scenario: Scenario) => void
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
  existingHardware: blankExistingHardware(),
  managementDeploymentInputs: null as ManagementDeploymentInputs | null,
  managementAdvisorAnswers: {} as AdvisorAnswers,
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
  costModel: structuredClone(DEFAULT_COST_MODEL_INPUTS),
})

/** Settles once the persisted state has been read, whether or not reading succeeded. */
let settleHydration: () => void = () => {}
export const storeHydrated = new Promise<void>((resolve) => { settleHydration = resolve })

export const dataSourceKind = (report: Pick<ImportReport, 'format'>): ProjectDataSource['kind'] =>
  report.format === 'inventory-template' ? 'inventory' : 'rvtools'

const newId = (prefix: string) => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? `${prefix}-${crypto.randomUUID()}`
  : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export function payloadFromState(state: SurveyorState): ProjectPayload {
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
    existingHardware: structuredClone(state.existingHardware),
    managementDeploymentInputs: structuredClone(state.managementDeploymentInputs),
    managementAdvisorAnswers: structuredClone(state.managementAdvisorAnswers),
    includeManagementInSizing: state.includeManagementInSizing,
    placementInputs: structuredClone(state.placementInputs),
    networkDesignInputs: structuredClone(state.networkDesignInputs),
    drDesignInputs: structuredClone(state.drDesignInputs),
    reportMetadata: structuredClone(state.reportMetadata),
    dataSources: structuredClone(state.dataSources),
    storageDecisionAnswers: structuredClone(state.storageDecisionAnswers),
    costModel: structuredClone(state.costModel),
  }
}

/** Brings any older saved state up to the current shape. */
export function migratePersistedState(persisted: unknown): SurveyorState {
  const value = (persisted ?? {}) as Partial<SurveyorState>
  const lastImport = value.lastImport && value.lastImport.hostSummary && !Array.isArray(value.lastImport.hostSummary.perHost)
    ? { ...value.lastImport, hostSummary: { ...value.lastImport.hostSummary, perHost: [] } }
    : value.lastImport ?? null
  return {
    ...defaults(),
    ...value,
    vms: normalizeVms(value.vms),
    lastImport,
    engagementMode: normalizeEngagementMode(value.engagementMode, Array.isArray(value.vms) && value.vms.length > 0 ? 'new-platform' : null),
    managementDecision: value.managementDecision === undefined && value.managementDeploymentInputs ? 'design' : normalizeManagementDecision(value.managementDecision),
    cfg: normalizeProposedConfig(value.cfg),
    tiers: normalizeTiers(value.tiers),
    placementInputs: normalizePlacementInputs(value.placementInputs),
    storageDecisionAnswers: normalizeStorageDecisionAnswers(value.storageDecisionAnswers),
    existingCapacityCfg: normalizeConfig(value.existingCapacityCfg),
    existingCapacityTiers: normalizeTiers(value.existingCapacityTiers),
    // Saves before version 9 carry one host spec and a count; they become one cluster with one group.
    existingHardware: normalizeExistingHardware(value.existingHardware, value.existingCapacityCfg ? normalizeConfig(value.existingCapacityCfg) : undefined, typeof value.existingCapacityNodes === 'number' ? value.existingCapacityNodes : 8),
    savedScenarios: normalizeScenarioSnapshots(value.savedScenarios),
    managementDeploymentInputs: normalizeManagementInputs(value.managementDeploymentInputs),
    managementAdvisorAnswers: normalizeAdvisorAnswers(value.managementAdvisorAnswers),
    // Saves before version 10 have no Cost Model inputs; they open with the defaults.
    costModel: normalizeCostModelInputs(value.costModel),
  } as SurveyorState
}

export const useSurveyorStore = create<SurveyorState>()(
  persist(
    (set) => ({
      ...defaults(),
      setLastImport: (lastImport) => set({ lastImport }),
      setStorageDecisionAnswers: (storageDecisionAnswers) => set({ storageDecisionAnswers }),
      setCostModel: (costModel) => set({ costModel: normalizeCostModelInputs(costModel) }),
      setEngagementMode: (engagementMode) => set({ engagementMode }),
      setManagementDecision: (managementDecision) => set({ managementDecision }),
      setCustomerName: (customerName) => set({ customerName }),
      setVms: (vms) => set({ vms }),
      setCfg: (cfg) => set({ cfg }),
      setTiers: (tiers) => set({ tiers }),
      setChosenKey: (chosenKey) => set({ chosenKey }),
      selectDesignOption: (option, mode = 'one-cluster') => {
        const state = useSurveyorStore.getState()
        const selection = optionSelection(option, state.cfg, mode)
        if (!selection) return false
        set({
          chosenKey: selection.chosenKey,
          cfg: selection.cfg,
          placementInputs: { ...state.placementInputs, clusterLayout: mode === 'split' ? 'split' : 'single' },
        })
        return true
      },
      setOutlierDecision: (vmId, choice, capGiB) => set((state) => ({ vms: applyOutlierDecision(state.vms, vmId, choice, capGiB) })),
      setExistingCapacityCfg: (existingCapacityCfg) => set({ existingCapacityCfg }),
      setExistingCapacityTiers: (existingCapacityTiers) => set({ existingCapacityTiers }),
      setExistingCapacityNodes: (existingCapacityNodes) => set({ existingCapacityNodes }),
      setExistingHardware: (hardware) => set({ existingHardware: { ...hardware, confirmed: true, looksLikeOldDefaults: false }, existingCapacityNodes: Math.max(1, totalHostCount(hardware)) }),
      confirmExistingHardware: () => set((state) => ({ existingHardware: { ...state.existingHardware, confirmed: true, looksLikeOldDefaults: false } })),
      setExistingVmProfile: (vmProfile) => set((state) => ({ existingHardware: { ...state.existingHardware, vmProfile } })),
      setExistingAddSpec: (addSpecGroupId) => set((state) => ({ existingHardware: { ...state.existingHardware, addSpecGroupId } })),
      fillExistingHardwareFromImport: () => {
        const state = useSurveyorStore.getState()
        const hosts = state.lastImport?.hostSummary?.perHost ?? []
        if (hosts.length === 0) return false
        const existingHardware = existingHardwareFromImport(hosts, state.existingHardware)
        set({ existingHardware, existingCapacityNodes: Math.max(1, totalHostCount(existingHardware)) })
        return true
      },
      setManagementDeploymentInputs: (managementDeploymentInputs) => set({ managementDeploymentInputs }),
      setManagementAdvisorAnswers: (answers) => set((state) => {
        const managementAdvisorAnswers = normalizeAdvisorAnswers(answers)
        const answered = Object.keys(managementAdvisorAnswers).length > 0
        return {
          managementAdvisorAnswers,
          managementDecision: answered && state.managementDecision === 'unassessed' ? 'design' : state.managementDecision,
        }
      }),
      setIncludeManagementInSizing: (includeManagementInSizing) => set({ includeManagementInSizing }),
      saveNamedScenario: (name) => set((state) => {
        const snapshot: ScenarioSnapshot = {
          ...payloadFromState(state),
          id: newId('scenario'),
          name: name.trim() || `Scenario ${state.savedScenarios.length + 1}`,
          createdAt: new Date().toISOString(),
        }
        return { savedScenarios: [snapshot, ...state.savedScenarios] }
      }),
      loadNamedScenario: (id) => set((state) => {
        const snapshot = state.savedScenarios.find((item) => item.id === id)
        // The import banner describes the previous inventory, so it goes with it.
        return snapshot ? { ...normalizeProjectPayload(snapshot), managementAdvisorAnswers: normalizeAdvisorAnswers(snapshot.managementAdvisorAnswers), sharedInventoryOmitted: null, lastImport: null } : {}
      }),
      deleteNamedScenario: (id) => set((state) => ({ savedScenarios: state.savedScenarios.filter((item) => item.id !== id) })),
      loadProject: (payload, savedScenarios) => set((state) => ({
        ...normalizeProjectPayload(payload),
        managementAdvisorAnswers: normalizeAdvisorAnswers(payload.managementAdvisorAnswers),
        savedScenarios: savedScenarios ? normalizeScenarioSnapshots(savedScenarios) : state.savedScenarios,
        sharedInventoryOmitted: null,
        lastImport: null,
      })),
      setPlacementInputs: (placementInputs) => set({ placementInputs }),
      setNetworkDesignInputs: (networkDesignInputs) => set({ networkDesignInputs }),
      setDrDesignInputs: (drDesignInputs) => set({ drDesignInputs }),
      setReportMetadata: (reportMetadata) => set({ reportMetadata }),
      addDataSource: (source) => set((state) => ({ dataSources: [{ ...source, id: newId('source'), importedAt: new Date().toISOString() }, ...state.dataSources] })),
      applyImport: (mode, report, fileName) => set((state) => {
        const source: ProjectDataSource = { id: newId('source'), kind: dataSourceKind(report), fileName, rows: report.totalRows, importedAt: new Date().toISOString() }
        const summary = summarizeImport(report, fileName)
        if (mode === 'replace' || state.vms.length === 0) {
          // Replacing drops the old rows, so their file and performance sources no longer apply.
          return { vms: report.vms, lastImport: summary, dataSources: [source], sharedInventoryOmitted: null }
        }
        const merge = mergeInventories(state.vms, report.vms)
        return { vms: merge.vms, lastImport: combineImportSummaries(state.lastImport, summary, merge), dataSources: [source, ...state.dataSources], sharedInventoryOmitted: null }
      }),
      clearWorkloads: () => set({ vms: [], lastImport: null, dataSources: [], sharedInventoryOmitted: null }),
      dismissSharedInventoryNotice: () => set({ sharedInventoryOmitted: null }),
      resetExistingCapacity: () => set({
        existingCapacityCfg: structuredClone(DEFAULT_CONFIG),
        existingCapacityTiers: defaultTiers(),
        existingCapacityNodes: 8,
        existingHardware: blankExistingHardware(),
      }),
      loadScenario: (scenario) => set((state) => {
        const replacesInventory = scenario.vms !== undefined
        // A link that replaces local workloads first keeps them as a named scenario, so opening
        // a link never silently destroys local work.
        const keepLocal = replacesInventory && state.vms.length > 0 && JSON.stringify(state.vms) !== JSON.stringify(scenario.vms)
        const backup: ScenarioSnapshot[] = keepLocal
          ? [{ ...payloadFromState(state), id: newId('scenario'), name: `Local work before shared link (${new Date().toLocaleString()})`, createdAt: new Date().toISOString() }]
          : []
        const next: Partial<SurveyorState> = {
          engagementMode: normalizeEngagementMode(scenario.engagementMode, scenario.vms && scenario.vms.length > 0 ? 'new-platform' : state.engagementMode),
          managementDecision: scenario.managementDecision === undefined ? state.managementDecision : normalizeManagementDecision(scenario.managementDecision),
          customerName: scenario.customerName ?? state.customerName,
          vms: scenario.vms ?? state.vms,
          cfg: normalizeProposedConfig(scenario.cfg),
          tiers: normalizeTiers(scenario.tiers),
          sharedInventoryOmitted: scenario.inventoryOmitted ?? null,
          lastImport: replacesInventory ? null : state.lastImport,
          savedScenarios: [...backup, ...state.savedScenarios],
          existingCapacityCfg: scenario.existingCapacityCfg ? normalizeConfig(scenario.existingCapacityCfg) : state.existingCapacityCfg,
          existingCapacityTiers: scenario.existingCapacityTiers ? normalizeTiers(scenario.existingCapacityTiers) : state.existingCapacityTiers,
          existingCapacityNodes: typeof scenario.existingCapacityNodes === 'number' ? Math.max(1, scenario.existingCapacityNodes) : state.existingCapacityNodes,
          // A link from before host groups carries one spec and a count: it migrates the same way a project does.
          existingHardware: scenario.existingHardware
            ? normalizeExistingHardware(scenario.existingHardware)
            : scenario.existingCapacityCfg
              ? normalizeExistingHardware(undefined, normalizeConfig(scenario.existingCapacityCfg), typeof scenario.existingCapacityNodes === 'number' ? scenario.existingCapacityNodes : 8)
              : state.existingHardware,
        }
        if (scenario.chosenKey !== undefined) next.chosenKey = scenario.chosenKey
        if (scenario.managementDeploymentInputs !== undefined) next.managementDeploymentInputs = normalizeManagementInputs(scenario.managementDeploymentInputs)
        if (scenario.managementAdvisorAnswers !== undefined) next.managementAdvisorAnswers = normalizeAdvisorAnswers(scenario.managementAdvisorAnswers)
        if (scenario.includeManagementInSizing !== undefined) next.includeManagementInSizing = scenario.includeManagementInSizing
        if (scenario.placementInputs !== undefined) next.placementInputs = normalizePlacementInputs(scenario.placementInputs)
        if (scenario.networkDesignInputs !== undefined) next.networkDesignInputs = scenario.networkDesignInputs
        if (scenario.drDesignInputs !== undefined) next.drDesignInputs = scenario.drDesignInputs
        if (scenario.reportMetadata !== undefined) next.reportMetadata = scenario.reportMetadata
        if (scenario.dataSources !== undefined) next.dataSources = scenario.dataSources
        if (scenario.storageDecisionAnswers !== undefined) next.storageDecisionAnswers = normalizeStorageDecisionAnswers(scenario.storageDecisionAnswers)
        if (scenario.costModel !== undefined) next.costModel = normalizeCostModelInputs(scenario.costModel)
        return next
      }),
      // The demo is a new inventory, so the previous import summary and sources no longer apply.
      loadDemo: () => set({ vms: demoFleet(), lastImport: null, dataSources: [], sharedInventoryOmitted: null }),
      resetScenario: () => set(defaults()),
    }),
    {
      name: 'hyperv-surveyor-state',
      // 6 normalizes saved VMs and scenarios, such as numbers saved as text.
      // 7 keeps the Management Plane Advisor answers and marks who owns the management stack.
      // 8 adds storage-outlier choices on VMs (Data check); malformed ones are dropped on load.
      // 9 keeps existing hardware as clusters of host groups, migrated from the single-spec fields.
      // 10 keeps the Cost Model inputs; older saves open with the defaults.
      version: 10,
      storage: createJSONStorage(() => surveyorStorage),
      onRehydrateStorage: () => () => settleHydration(),
      migrate: (persisted) => migratePersistedState(persisted),
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
        existingHardware: state.existingHardware,
        managementDeploymentInputs: state.managementDeploymentInputs,
        managementAdvisorAnswers: state.managementAdvisorAnswers,
        includeManagementInSizing: state.includeManagementInSizing,
        placementInputs: state.placementInputs,
        networkDesignInputs: state.networkDesignInputs,
        drDesignInputs: state.drDesignInputs,
        reportMetadata: state.reportMetadata,
        dataSources: state.dataSources,
        lastImport: state.lastImport,
        storageDecisionAnswers: state.storageDecisionAnswers,
        costModel: state.costModel,
        savedScenarios: state.savedScenarios,
        sharedInventoryOmitted: state.sharedInventoryOmitted,
        vms: state.vms,
      }),
    },
  ),
)

/**
 * Waits for saved state to load, then applies a shared link over it. Nothing that reads the store
 * renders before this settles, so neither defaults nor the pre-link state ever show.
 */
export async function prepareStore(shared: Scenario | null): Promise<void> {
  await storeHydrated
  if (shared) useSurveyorStore.getState().loadScenario(shared)
}
