import { designResultLabel, resolvePlatformDesign, type PlatformDesign } from '../engine/platformDesign'
import type { ProjectPayload } from './project'
import { platformDesignInputs } from './usePlatformDesign'

export interface ScenarioComparisonRow {
  design: PlatformDesign
  architecture: string
  nodes: string
  result: string
  storage: string
}

/** One row of the Project & scenarios comparison, from the same design function as every other page. */
export function compareScenario(scenario: ProjectPayload): ScenarioComparisonRow {
  const design = resolvePlatformDesign(platformDesignInputs(scenario))
  const managementOnly = design.path === 'management-only'
  return {
    design,
    architecture: managementOnly ? 'Management only' : design.platformLabel,
    nodes: managementOnly ? '—' : design.path === 'existing' ? `${design.nodesLabel} existing` : design.nodesLabel,
    result: designResultLabel(design),
    storage: design.storage ? `${design.storage.requiredTiB.toFixed(1)} TiB` : '—',
  }
}
