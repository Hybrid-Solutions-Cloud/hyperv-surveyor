import { solveForward, solveReverse } from './solve'
import { hasErrors } from './validate'
import type { ClusterConfig, ReverseResult, SizingResult, TierId, TierPolicy, Vm } from './types'

export interface FitGapAssessment {
  assessedVms: number
  fits: boolean | null
  existingNodes: number
  /** Management VMs counted in this result, in addition to assessedVms. */
  managementVms: number
  /** Total nodes for a valid design. Null when node count alone cannot produce one. */
  requiredNodesAtSameSpec: number | null
  additionalNodes: number | null
  /** Total nodes for CPU, memory and VM count, shown even when storage blocks the design. */
  requiredNodesForCompute: number | null
  additionalNodesForCompute: number | null
  /** Storage problems, stated separately from the compute answer. */
  storageShortfalls: string[]
  /** Hard findings that block the design whatever the node count. */
  blockers: string[]
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

const NO_WORKLOADS_LABEL = 'Add workloads'
const NO_COUNT_LABEL = 'No node count works'

/** The required-nodes answer. Compute is always shown when known, even when storage blocks. */
export function fitGapRequiredLabel(result: FitGapAssessment): string | number {
  if (result.assessedVms === 0) return NO_WORKLOADS_LABEL
  if (result.requiredNodesAtSameSpec !== null) return result.requiredNodesAtSameSpec
  return result.requiredNodesForCompute !== null ? `${result.requiredNodesForCompute} for compute` : NO_COUNT_LABEL
}

/** The additional-nodes answer, on the same terms as the required-nodes answer. */
export function fitGapAdditionalLabel(result: FitGapAssessment): string | number {
  if (result.assessedVms === 0) return NO_WORKLOADS_LABEL
  if (result.additionalNodes !== null) return result.additionalNodes
  return result.additionalNodesForCompute !== null ? `${result.additionalNodesForCompute} for compute` : NO_COUNT_LABEL
}

/**
 * Tests a real workload against a fixed estate, then asks whether adding nodes of the
 * same specification can close the gap. Array capacity remains independent of host count.
 * managementVms are counted, at a fixed size, when the management plane shares this hardware.
 */
export function assessFitGap(
  cfg: ClusterConfig,
  existingNodes: number,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
  managementVms: Vm[] = [],
): FitGapAssessment {
  const nodes = Math.max(1, Math.round(existingNodes))
  const assessedVms = vms.filter((vm) => vm.include).length
  const reverse = solveReverse(cfg, nodes, vms, tiers, managementVms)
  const required = solveForward(cfg, vms, tiers, managementVms)
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
    : required.feasible && required.nodes <= nodes && !hasErrors(reverse.findings) && reverse.status === 'fits'
  const requiredNodesAtSameSpec = assessedVms > 0 && required.feasible ? required.nodes : null
  const additionalNodes = requiredNodesAtSameSpec === null ? null : Math.max(0, requiredNodesAtSameSpec - nodes)
  const requiredNodesForCompute = assessedVms > 0 ? required.computeNodesNeeded : null
  const additionalNodesForCompute = requiredNodesForCompute === null ? null : Math.max(0, requiredNodesForCompute - nodes)
  const storageShortfalls: string[] = []
  if (assessedVms > 0) {
    if (deficits.sanTiB > 0) storageShortfalls.push(`The SAN is ${deficits.sanTiB.toFixed(1)} TiB short. Adding hosts does not change the array.`)
    if (deficits.s2dTiB > 0) storageShortfalls.push(`S2D is ${deficits.s2dTiB.toFixed(1)} TiB short on ${nodes} nodes.`)
    reverse.findings
      .filter((finding) => finding.code === 'SAN_PERFORMANCE_EXCEEDED' || finding.code === 'S2D_PERFORMANCE_EXCEEDED')
      .forEach((finding) => storageShortfalls.push(finding.message))
  }
  const blockers = assessedVms > 0 ? reverse.blockers : []
  const recommendations: string[] = []

  if (assessedVms === 0) {
    recommendations.push('Import or enter workloads to calculate a fit decision. The capacity envelope and nominal VM profiles remain available without an inventory.')
  } else if (fits) {
    recommendations.push(`The complete included estate fits on the ${nodes}-node hardware profile after the selected failure reserve and host reserves.`)
  } else if (additionalNodes !== null && additionalNodes > 0) {
    recommendations.push(`Add ${additionalNodes} node${additionalNodes === 1 ? '' : 's'} of the same specification to reach the calculated ${requiredNodesAtSameSpec}-node requirement.`)
  } else if (additionalNodes === 0) {
    recommendations.push(`The workload needs ${requiredNodesAtSameSpec} nodes, so adding hosts will not help. Resolve the findings that block this ${nodes}-node design.`)
  } else if (requiredNodesForCompute !== null) {
    recommendations.push(additionalNodesForCompute
      ? `Compute needs ${requiredNodesForCompute} nodes, ${additionalNodesForCompute} more than today. That alone does not make the design fit: resolve the blocker below as well.`
      : `Compute needs ${requiredNodesForCompute} nodes, which this estate already has. The blocker is elsewhere: see below.`)
  }
  if (assessedVms > 0) {
    const freeSpace = reverse.findings.find((finding) => finding.code === 'SAN_FREE_SPACE_TARGET')
    if (freeSpace) recommendations.push(freeSpace.message)
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
    managementVms: managementVms.filter((vm) => vm.include).length,
    requiredNodesAtSameSpec,
    additionalNodes,
    requiredNodesForCompute,
    additionalNodesForCompute,
    storageShortfalls,
    blockers,
    reverse,
    required,
    deficits,
    recommendations: [...new Set(recommendations)],
  }
}
