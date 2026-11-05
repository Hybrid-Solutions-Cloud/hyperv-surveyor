import { DEFAULT_CONFIG, DEFAULT_PROPOSED_CONFIG, defaultTiers } from './defaults'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'
import type { ManagementDeploymentInputs } from '../engine/managementDeployment'
import { normalizePlacementInputs, type PlacementInputs } from '../engine/deploymentPlanning'
import { normalizeNetworkDesignInputs, type NetworkDesignInputs } from '../engine/networkDesign'
import { normalizeDrDesignInputs, type DrDesignInputs } from '../engine/drDesign'
import { normalizeEngagementMode, normalizeManagementDecision, type EngagementMode, type ManagementDecision } from './journey'
import type { StorageDecisionAnswers } from '../engine/storageDecision'
import { normalizeAdvisorAnswers, type AdvisorAnswers } from '../data/managementPlane'
import { normalizeExistingHardware, type ExistingHardware } from '../engine/existingHardware'
import { normalizeCostModelInputs, type CostModelInputs } from '../engine/licensing'

/**
 * 5 added savedScenarios to the project file. 6 added the Management Plane Advisor answers. 7 added
 * existing hardware as clusters of host groups; older files migrate from the single-spec fields. 8 added
 * the Cost Model inputs; older files open with the defaults. 9 added network intents, BMC ports, SAN
 * connectivity and recovery assumptions; older files build intents from their adapter count.
 */
export const PROJECT_SCHEMA_VERSION = 9 as const
export const ENGINE_VERSION = '1.2.0'

export interface ReportMetadata {
  author: string
  organization: string
  revision: string
  approvalStatus: 'draft' | 'review' | 'approved'
  decisionNotes: string
  /** Storage designs shown in the report. Absent means all of them. */
  architectureKeys?: string[]
}

export const DEFAULT_REPORT_METADATA: ReportMetadata = {
  author: '',
  organization: '',
  revision: '1.0',
  approvalStatus: 'draft',
  decisionNotes: '',
}

export interface ProjectDataSource {
  id: string
  kind: 'rvtools' | 'inventory' | 'performance'
  fileName: string
  importedAt: string
  rows: number
}

export interface ProjectPayload {
  engagementMode: EngagementMode | null
  managementDecision: ManagementDecision
  customerName: string
  vms: Vm[]
  cfg: ClusterConfig
  tiers: Record<TierId, TierPolicy>
  chosenKey: string
  existingCapacityCfg: ClusterConfig
  existingCapacityTiers: Record<TierId, TierPolicy>
  /** Read only when existingHardware is absent (files before schema 7). */
  existingCapacityNodes: number
  /** Your hosts as clusters of host groups. Absent in files written before schema 7. */
  existingHardware?: ExistingHardware
  managementDeploymentInputs: ManagementDeploymentInputs | null
  includeManagementInSizing: boolean
  placementInputs: PlacementInputs
  networkDesignInputs: NetworkDesignInputs
  drDesignInputs: DrDesignInputs
  reportMetadata: ReportMetadata
  dataSources: ProjectDataSource[]
  storageDecisionAnswers: StorageDecisionAnswers
  /** Management Plane Advisor answers. Absent in files written before schema 6. */
  managementAdvisorAnswers?: AdvisorAnswers
  /** Cost Model inputs. Absent in files written before schema 8. */
  costModel?: CostModelInputs
}

export interface SurveyorProject {
  kind: 'hyperv-surveyor-project'
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  engineVersion: string
  exportedAt: string
  payload: ProjectPayload
  /** Named scenarios. Absent in files written before schema 5, which carried none. */
  savedScenarios?: ScenarioSnapshot[]
}

export interface ScenarioSnapshot extends ProjectPayload {
  id: string
  name: string
  createdAt: string
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeConfig(value: unknown): ClusterConfig {
  const input = record(value) ? value as Partial<ClusterConfig> : {}
  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...input,
    node: { ...DEFAULT_CONFIG.node, ...(record(input.node) ? input.node : {}) },
    san: { ...DEFAULT_CONFIG.san, ...(record(input.san) ? input.san : {}) },
  }
}

/**
 * The proposed-design config. Older saves have no SAN sizing mode: a customised array size is kept
 * as a fixed limit, while the untouched 500 TiB default was never real and becomes calculated.
 */
export function normalizeProposedConfig(value: unknown): ClusterConfig {
  const config = normalizeConfig(value)
  if (config.sanSizingMode === 'fixed' || config.sanSizingMode === 'calculated') return config
  if (config.san.usableTiB !== DEFAULT_CONFIG.san.usableTiB) return { ...config, sanSizingMode: 'fixed' }
  return { ...config, sanSizingMode: DEFAULT_PROPOSED_CONFIG.sanSizingMode, sanFreeSpaceTargetPct: config.sanFreeSpaceTargetPct ?? DEFAULT_PROPOSED_CONFIG.sanFreeSpaceTargetPct }
}

export function normalizeTiers(value: unknown): Record<TierId, TierPolicy> {
  const input = record(value) ? value : {}
  const defaults = defaultTiers()
  return Object.fromEntries((Object.keys(defaults) as TierId[]).map((id) => [id, {
    ...defaults[id],
    ...(record(input[id]) ? input[id] : {}),
  }])) as Record<TierId, TierPolicy>
}

function normalizeVm(value: unknown, index: number): Vm | null {
  if (!record(value) || typeof value.name !== 'string') return null
  const tier = ['general', 'database', 'vdi', 'infrastructure'].includes(String(value.tier)) ? value.tier as TierId : 'general'
  // Older saves and hand-edited files can hold numbers as text, such as vCpu: "4".
  const number = (candidate: unknown, fallback = 0) => {
    const value = typeof candidate === 'string' && candidate.trim() !== '' ? Number(candidate) : candidate
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }
  return {
    ...(value as unknown as Vm),
    id: typeof value.id === 'string' ? value.id : `project-${index + 1}`,
    name: value.name,
    tier,
    vCpu: Math.max(0, number(value.vCpu)),
    ramGiB: Math.max(0, number(value.ramGiB)),
    storageGiB: Math.max(0, number(value.storageGiB)),
    provisionedGiB: Math.max(0, number(value.provisionedGiB, number(value.storageGiB))),
    powerState: ['poweredOn', 'poweredOff', 'suspended'].includes(String(value.powerState)) ? value.powerState as Vm['powerState'] : 'poweredOn',
    include: typeof value.include === 'boolean' ? value.include : true,
    outlierDecision: normalizeOutlierDecision(value.outlierDecision),
  }
}

/** A storage-outlier choice from the Data check page. Anything malformed is dropped, never guessed. */
export function normalizeOutlierDecision(value: unknown): Vm['outlierDecision'] {
  if (!record(value)) return undefined
  const choice = value.choice
  if (choice !== 'keep' && choice !== 'cap' && choice !== 'exclude') return undefined
  const originalStorageGiB = typeof value.originalStorageGiB === 'number' && Number.isFinite(value.originalStorageGiB) ? Math.max(0, value.originalStorageGiB) : null
  if (originalStorageGiB === null) return undefined
  const decision: NonNullable<Vm['outlierDecision']> = {
    choice,
    originalStorageGiB,
    originalInclude: typeof value.originalInclude === 'boolean' ? value.originalInclude : true,
  }
  if (choice === 'cap') {
    if (!(typeof value.capGiB === 'number' && Number.isFinite(value.capGiB))) return undefined
    decision.capGiB = Math.max(0, value.capGiB)
  }
  return decision
}

export function normalizeStorageDecisionAnswers(value: unknown): StorageDecisionAnswers {
  if (!record(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
}

/**
 * Saved management inputs. Saves made before the advisor answers were kept have no stackSource; their
 * stack was picked on the Deployment design tab, so it stays the user's. Those saves also froze the SCOM
 * daily data at the automatic value (managed VMs / 500, at least 1 GiB), which is dropped so it follows
 * the managed estate again; any other value was typed by the user and is kept.
 */
export function normalizeManagementInputs(value: unknown): ManagementDeploymentInputs | null {
  if (!record(value)) return null
  const inputs = { ...(value as unknown as ManagementDeploymentInputs) }
  if (inputs.stackSource !== 'advisor' && inputs.stackSource !== 'user') {
    const legacy = inputs.stackSource === undefined
    inputs.stackSource = 'user'
    const daily = inputs.scomDailyDataGiB
    const managedVms = typeof inputs.managedVms === 'number' ? inputs.managedVms : 0
    // Only a value equal to the formula at these managed VMs is known to be automatic. Anything else,
    // including 1 GiB at a larger estate, may have been typed, so it is kept and counts as set by you.
    if (legacy && typeof daily === 'number' && daily === Math.max(1, managedVms / 500)) delete inputs.scomDailyDataGiB
  }
  if (inputs.scomDailyDataGiB !== undefined && !(typeof inputs.scomDailyDataGiB === 'number' && Number.isFinite(inputs.scomDailyDataGiB))) delete inputs.scomDailyDataGiB
  return inputs
}

export function normalizeProjectPayload(value: unknown): ProjectPayload {
  if (!record(value)) throw new Error('The project payload is missing or invalid.')
  const vms = normalizeVms(value.vms)
  const existingCapacityCfg = normalizeConfig(value.existingCapacityCfg)
  const existingCapacityNodes = typeof value.existingCapacityNodes === 'number' ? Math.max(1, value.existingCapacityNodes) : 8
  return {
    engagementMode: normalizeEngagementMode(value.engagementMode, vms.length > 0 ? 'new-platform' : null),
    managementDecision: value.managementDecision === undefined && record(value.managementDeploymentInputs) ? 'design' : normalizeManagementDecision(value.managementDecision),
    customerName: typeof value.customerName === 'string' ? value.customerName : '',
    vms,
    cfg: normalizeProposedConfig(value.cfg),
    tiers: normalizeTiers(value.tiers),
    chosenKey: typeof value.chosenKey === 'string' ? value.chosenKey : 'san',
    existingCapacityCfg,
    existingCapacityTiers: normalizeTiers(value.existingCapacityTiers),
    existingCapacityNodes,
    // Older files carry one host spec and a count: they migrate to one cluster with one host group.
    existingHardware: normalizeExistingHardware(value.existingHardware, record(value.existingCapacityCfg) ? existingCapacityCfg : undefined, existingCapacityNodes),
    managementDeploymentInputs: normalizeManagementInputs(value.managementDeploymentInputs),
    managementAdvisorAnswers: normalizeAdvisorAnswers(value.managementAdvisorAnswers),
    includeManagementInSizing: typeof value.includeManagementInSizing === 'boolean' ? value.includeManagementInSizing : true,
    placementInputs: normalizePlacementInputs(value.placementInputs),
    // Files before schema 9 have no intents or SAN connectivity: intents come from the adapter count.
    networkDesignInputs: normalizeNetworkDesignInputs(value.networkDesignInputs),
    drDesignInputs: normalizeDrDesignInputs(value.drDesignInputs),
    reportMetadata: { ...DEFAULT_REPORT_METADATA, ...(record(value.reportMetadata) ? value.reportMetadata : {}) },
    storageDecisionAnswers: normalizeStorageDecisionAnswers(value.storageDecisionAnswers),
    // Absent means the file or link carries no Cost Model: the current one is kept, like other missing fields.
    costModel: record(value.costModel) ? normalizeCostModelInputs(value.costModel) : undefined,
    dataSources: Array.isArray(value.dataSources) ? value.dataSources.filter(record).map((source, index) => ({
      id: typeof source.id === 'string' ? source.id : `source-${index + 1}`,
      kind: source.kind === 'performance' || source.kind === 'inventory' ? source.kind : 'rvtools',
      fileName: typeof source.fileName === 'string' ? source.fileName : 'Unknown source',
      importedAt: typeof source.importedAt === 'string' ? source.importedAt : '',
      rows: typeof source.rows === 'number' ? source.rows : 0,
    })) : [],
  }
}

export function normalizeVms(value: unknown): Vm[] {
  return Array.isArray(value) ? value.map(normalizeVm).filter((vm): vm is Vm => vm !== null) : []
}

export function normalizeScenarioSnapshot(value: unknown, index: number): ScenarioSnapshot | null {
  if (!record(value)) return null
  try {
    return {
      ...normalizeProjectPayload(value),
      id: typeof value.id === 'string' ? value.id : `scenario-${index + 1}`,
      name: typeof value.name === 'string' && value.name.trim() ? value.name : `Scenario ${index + 1}`,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    }
  } catch {
    return null
  }
}

export function normalizeScenarioSnapshots(value: unknown): ScenarioSnapshot[] {
  return Array.isArray(value) ? value.map(normalizeScenarioSnapshot).filter((item): item is ScenarioSnapshot => item !== null) : []
}

export function createProject(payload: ProjectPayload, savedScenarios: ScenarioSnapshot[] = []): SurveyorProject {
  return { kind: 'hyperv-surveyor-project', schemaVersion: PROJECT_SCHEMA_VERSION, engineVersion: ENGINE_VERSION, exportedAt: new Date().toISOString(), payload, savedScenarios }
}

export function parseProject(text: string): SurveyorProject {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('This is not valid JSON.') }
  if (!record(parsed) || parsed.kind !== 'hyperv-surveyor-project') throw new Error('This is not a Hyper-V Surveyor project file.')
  if (typeof parsed.schemaVersion !== 'number' || parsed.schemaVersion > PROJECT_SCHEMA_VERSION) {
    throw new Error(`This project was created by a newer schema version (${String(parsed.schemaVersion)}). Update Surveyor before opening it.`)
  }
  return {
    kind: 'hyperv-surveyor-project',
    schemaVersion: PROJECT_SCHEMA_VERSION,
    engineVersion: typeof parsed.engineVersion === 'string' ? parsed.engineVersion : 'legacy',
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
    payload: normalizeProjectPayload(parsed.payload),
    savedScenarios: Array.isArray(parsed.savedScenarios) ? normalizeScenarioSnapshots(parsed.savedScenarios) : undefined,
  }
}

export function downloadProject(project: SurveyorProject) {
  const slug = project.payload.customerName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'hyperv-design'
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${slug}.hvsurveyor.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
