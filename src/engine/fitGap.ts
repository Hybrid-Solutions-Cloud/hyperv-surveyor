import { solveForward, solveReverse } from './solve'
import { hasErrors } from './validate'
import type { ClusterConfig, ReverseResult, SizingResult, TierId, TierPolicy, Vm } from './types'

export interface FitGapAssessment {
  assessedVms: number
  fits: boolean | null
  existingNodes: number
  requiredNodesAtSameSpec: number | null
  additionalNodes: number | null
  reverse: ReverseResult
  required: SizingResult
  deficits: {
    physicalCores: number
    ramGiB: number
    s2dTiB: number
    sanTiB: number
  }
  recommendations: string[]
}

/**
 * Tests a real workload against a fixed estate, then asks whether adding nodes of the
 * same specification can close the gap. Array capacity remains independent of host count.
 */
export function assessFitGap(
  cfg: ClusterConfig,
  existingNodes: number,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
): FitGapAssessment {
  const nodes = Math.max(1, Math.round(existingNodes))
  const assessedVms = vms.filter((vm) => vm.include).length
  const reverse = solveReverse(cfg, nodes, vms, tiers)
  const required = solveForward(cfg, vms, tiers)
  const s2d = reverse.storageDomains.find((domain) => domain.domain === 's2d')
  const san = reverse.storageDomains.find((domain) => domain.domain === 'san')
  const deficits = {
    physicalCores: Math.max(0, -reverse.headroomPCores),
    ramGiB: Math.max(0, -reverse.headroomRamGiB),
    s2dTiB: Math.max(0, -(s2d?.headroomTiB ?? 0)),
    sanTiB: Math.max(0, -(san?.headroomTiB ?? 0)),
  }
  const fits = assessedVms === 0
    ? null
    : required.feasible && required.nodes <= nodes && !hasErrors(reverse.findings)
  const requiredNodesAtSameSpec = assessedVms > 0 && required.feasible ? required.nodes : null
  const additionalNodes = requiredNodesAtSameSpec === null ? null : Math.max(0, requiredNodesAtSameSpec - nodes)
  const recommendations: string[] = []

  if (assessedVms === 0) {
    recommendations.push('Import or enter workloads to calculate a fit decision. The capacity envelope and nominal VM profiles remain available without an inventory.')
  } else if (fits) {
    recommendations.push(`The complete included estate fits on the ${nodes}-node hardware profile after the selected failure reserve and host reserves.`)
  } else if (additionalNodes !== null && additionalNodes > 0) {
    recommendations.push(`Add ${additionalNodes} node${additionalNodes === 1 ? '' : 's'} of the same specification to reach the calculated ${requiredNodesAtSameSpec}-node requirement.`)
  }

  if (deficits.physicalCores > 0) recommendations.push(`Close a ${deficits.physicalCores.toFixed(1)} physical-core deficit or reduce the approved CPU demand.`)
  if (deficits.ramGiB > 0) recommendations.push(`Close a ${deficits.ramGiB.toFixed(0)} GiB memory deficit or reduce the approved memory demand.`)
  if (deficits.s2dTiB > 0) recommendations.push(`Add ${deficits.s2dTiB.toFixed(1)} TiB of usable S2D capacity; capacity and resiliency must be recalculated together when nodes or drives change.`)
  if (deficits.sanTiB > 0) recommendations.push(`Expand effective SAN capacity by at least ${deficits.sanTiB.toFixed(1)} TiB. Adding compute nodes alone does not expand the array.`)
  if (assessedVms > 0 && !required.feasible) recommendations.push(`The same-spec expansion cannot produce a valid single-cluster design: ${required.bindingExplanation}`)
  if (assessedVms > 0 && reverse.findings.some((finding) => finding.severity === 'error')) recommendations.push('Resolve the hard platform or workload validation findings before approving placement.')

  return {
    assessedVms,
    fits,
    existingNodes: nodes,
    requiredNodesAtSameSpec,
    additionalNodes,
    reverse,
    required,
    deficits,
    recommendations: [...new Set(recommendations)],
  }
}
