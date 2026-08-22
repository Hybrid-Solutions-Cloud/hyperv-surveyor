import { DEFAULT_CONFIG, defaultTiers } from './defaults'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'
import type { ManagementDeploymentInputs } from '../engine/managementDeployment'
import { DEFAULT_PLACEMENT_INPUTS, type PlacementInputs } from '../engine/deploymentPlanning'
import { DEFAULT_NETWORK_INPUTS, type NetworkDesignInputs } from '../engine/networkDesign'
import { DEFAULT_DR_INPUTS, type DrDesignInputs } from '../engine/drDesign'

export const PROJECT_SCHEMA_VERSION = 3 as const
export const ENGINE_VERSION = '1.1.0'

export interface ReportMetadata {
  author: string
  organization: string
  revision: string
  approvalStatus: 'draft' | 'review' | 'approved'
  decisionNotes: string
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
  kind: 'rvtools' | 'performance'
  fileName: string
  importedAt: string
  rows: number
}

export interface ProjectPayload {
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
  placementInputs: PlacementInputs
  networkDesignInputs: NetworkDesignInputs
  drDesignInputs: DrDesignInputs
  reportMetadata: ReportMetadata
  dataSources: ProjectDataSource[]
}

export interface SurveyorProject {
  kind: 'hyperv-surveyor-project'
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  engineVersion: string
  exportedAt: string
  payload: ProjectPayload
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
  const number = (candidate: unknown, fallback = 0) => typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback
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
  }
}

export function normalizeProjectPayload(value: unknown): ProjectPayload {
  if (!record(value)) throw new Error('The project payload is missing or invalid.')
  const vms = Array.isArray(value.vms) ? value.vms.map(normalizeVm).filter((vm): vm is Vm => vm !== null) : []
  return {
    customerName: typeof value.customerName === 'string' ? value.customerName : '',
    vms,
    cfg: normalizeConfig(value.cfg),
    tiers: normalizeTiers(value.tiers),
    chosenKey: typeof value.chosenKey === 'string' ? value.chosenKey : 'san',
    existingCapacityCfg: normalizeConfig(value.existingCapacityCfg),
    existingCapacityTiers: normalizeTiers(value.existingCapacityTiers),
    existingCapacityNodes: typeof value.existingCapacityNodes === 'number' ? Math.max(1, value.existingCapacityNodes) : 8,
    managementDeploymentInputs: record(value.managementDeploymentInputs) ? value.managementDeploymentInputs as unknown as ManagementDeploymentInputs : null,
    includeManagementInSizing: typeof value.includeManagementInSizing === 'boolean' ? value.includeManagementInSizing : true,
    placementInputs: { ...DEFAULT_PLACEMENT_INPUTS, ...(record(value.placementInputs) ? value.placementInputs : {}) },
    networkDesignInputs: { ...DEFAULT_NETWORK_INPUTS, ...(record(value.networkDesignInputs) ? value.networkDesignInputs : {}) },
    drDesignInputs: { ...DEFAULT_DR_INPUTS, ...(record(value.drDesignInputs) ? value.drDesignInputs : {}) },
    reportMetadata: { ...DEFAULT_REPORT_METADATA, ...(record(value.reportMetadata) ? value.reportMetadata : {}) },
    dataSources: Array.isArray(value.dataSources) ? value.dataSources.filter(record).map((source, index) => ({
      id: typeof source.id === 'string' ? source.id : `source-${index + 1}`,
      kind: source.kind === 'performance' ? 'performance' : 'rvtools',
      fileName: typeof source.fileName === 'string' ? source.fileName : 'Unknown source',
      importedAt: typeof source.importedAt === 'string' ? source.importedAt : '',
      rows: typeof source.rows === 'number' ? source.rows : 0,
    })) : [],
  }
}

export function createProject(payload: ProjectPayload): SurveyorProject {
  return { kind: 'hyperv-surveyor-project', schemaVersion: PROJECT_SCHEMA_VERSION, engineVersion: ENGINE_VERSION, exportedAt: new Date().toISOString(), payload }
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
