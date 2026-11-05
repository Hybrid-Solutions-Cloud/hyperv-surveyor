/**
 * How the Management Plane Advisor result becomes the management deployment inputs.
 *
 * The rule: the stack fields (foundation, WAC, SCOM, Arc and the HA choices) follow the advisor until
 * the user picks one of them. Scale fields such as managed hosts, VMs, placement and retention are the
 * user's in every case. An advisor result that is not ready never becomes a stack: the deployment keeps
 * the user's choice, or shows a starting point that is labelled as one.
 */
import {
  describeRecommendedStack,
  recommendManagementPlane,
  type AdvisorAnswers,
  type AdvisorRecommendation,
  type AdvisorStatus,
  type PlaneId,
} from '../data/managementPlane'
import { deploymentInputsFromStack, type ManagementDeploymentInputs } from './managementDeployment'

export type ManagementInputsSource = 'saved' | 'advisor' | 'starting-point'

type StackFields = Pick<ManagementDeploymentInputs,
  'foundation' | 'wac' | 'monitoring' | 'includeArc' | 'highAvailability' | 'fabricHighAvailability' | 'scomHighAvailability'>

export interface ManagementAdvisorSummary {
  answers: AdvisorAnswers
  answeredCount: number
  status: AdvisorStatus | 'not-started'
  recommendation: AdvisorRecommendation
  /** Such as "SCVMM + WAC aMode + SCOM 2025 (monitoring)". */
  recommendedStack: string
  /** True or false when the advisor is ready; null when there is nothing to compare with. */
  matches: boolean | null
  /** How the deployment differs from a ready advisor result. */
  differences: string[]
}

export interface ResolvedManagementInputs {
  /** The inputs to plan from. scomDailyDataGiB stays absent when it follows the estate. */
  inputs: ManagementDeploymentInputs
  source: ManagementInputsSource
  advisor: ManagementAdvisorSummary
}

const FOUNDATION_LABEL = { classic: 'Classic Hyper-V tools', scvmm: 'SCVMM 2025' } as const
const WAC_LABEL = { none: 'no WAC gateway', 'wac-admin': 'WAC Administration Mode', 'wac-virtual': 'WAC Virtualization Mode' } as const
const MONITORING_LABEL = { none: 'no SCOM', 'scom-features': 'SCOM for reporting and forecasting only', scom: 'SCOM for monitoring' } as const

/** The stack a ready advisor result gives. Null when the advisor is not ready. */
export function advisorStackFields(recommendation: AdvisorRecommendation): StackFields | null {
  if (recommendation.status !== 'ready') return null
  return stackFieldsFrom(recommendation.stack, recommendation)
}

function stackFieldsFrom(stack: PlaneId[], recommendation: AdvisorRecommendation, highAvailability = recommendation.highAvailability): StackFields {
  return {
    foundation: stack.includes('scvmm') ? 'scvmm' : 'classic',
    wac: stack.includes('wac-virtual') ? 'wac-virtual' : stack.includes('wac-admin') ? 'wac-admin' : 'none',
    monitoring: recommendation.monitoring,
    includeArc: recommendation.arcServers,
    highAvailability,
    fabricHighAvailability: highAvailability,
    scomHighAvailability: highAvailability,
  }
}

/**
 * A starting point when the advisor is not ready: components the answers confirm, and for the rest
 * the host-count default (Classic up to 4 hosts, otherwise SCVMM) with WAC Administration Mode.
 * HA stays on unless the HA question says No. It is labelled as a starting point wherever it shows.
 */
export function startingPointStackFields(recommendation: AdvisorRecommendation, answers: AdvisorAnswers, contextNodes: number): StackFields {
  const foundationConfirmed = recommendation.stack.find((id) => id === 'classic' || id === 'scvmm')
  const wacConfirmed = recommendation.stack.find((id) => id === 'wac-admin' || id === 'wac-virtual')
  const stack: PlaneId[] = [
    foundationConfirmed ?? (contextNodes <= 4 ? 'classic' : 'scvmm'),
    wacConfirmed ?? 'wac-admin',
  ]
  return stackFieldsFrom(stack, recommendation, answers.managementHa !== false)
}

function differencesFrom(inputs: ManagementDeploymentInputs, target: StackFields): string[] {
  const differences: string[] = []
  if (inputs.foundation !== target.foundation) differences.push(`Foundation is ${FOUNDATION_LABEL[inputs.foundation]}; the advisor recommends ${FOUNDATION_LABEL[target.foundation]}.`)
  if (inputs.wac !== target.wac) differences.push(`WAC is ${WAC_LABEL[inputs.wac]}; the advisor recommends ${WAC_LABEL[target.wac]}.`)
  const monitoring = inputs.monitoring ?? 'none'
  if (monitoring !== target.monitoring) differences.push(`SCOM is ${MONITORING_LABEL[monitoring]}; the advisor recommends ${MONITORING_LABEL[target.monitoring]}.`)
  if (inputs.includeArc !== target.includeArc) differences.push(target.includeArc ? 'Azure Arc-enabled servers are not included; the advisor adds them.' : 'Azure Arc-enabled servers are included; the advisor does not add them.')
  const fabricHa = inputs.fabricHighAvailability ?? inputs.highAvailability ?? true
  if (fabricHa !== target.fabricHighAvailability) differences.push(`Management high availability is ${fabricHa ? 'on' : 'off'}; the HA answer is ${target.fabricHighAvailability ? 'Yes' : 'No'}.`)
  if (target.monitoring !== 'none' && monitoring !== 'none') {
    const scomHa = inputs.scomHighAvailability ?? inputs.highAvailability ?? true
    if (scomHa !== target.scomHighAvailability) differences.push(`SCOM high availability is ${scomHa ? 'on' : 'off'}; the HA answer is ${target.scomHighAvailability ? 'Yes' : 'No'}.`)
  }
  return differences
}

/**
 * Applies a ready advisor result to saved inputs. Only the stack fields change; managed hosts, VMs,
 * clusters, placement, Arc details, retention and every other scale field are kept.
 */
export function applyAdvisorResult(stored: ManagementDeploymentInputs, recommendation: AdvisorRecommendation): ManagementDeploymentInputs {
  const stack = advisorStackFields(recommendation)
  if (!stack) return stored
  return {
    ...stored,
    ...stack,
    stackSource: 'advisor',
    arcServices: stack.includeArc ? stored.arcServices : [],
    scomSqlPlacement: stack.fabricHighAvailability && stack.scomHighAvailability ? stored.scomSqlPlacement : 'dedicated',
  }
}

/**
 * The user picks a stack field. The stack becomes the user's and stops following the advisor; every
 * other field is kept, so choosing Classic never removes Azure Arc-enabled servers.
 */
export function withStackChoice(raw: ManagementDeploymentInputs, patch: Partial<StackFields> & Partial<Pick<ManagementDeploymentInputs, 'arcServices' | 'scomSqlPlacement'>>): ManagementDeploymentInputs {
  return { ...raw, ...patch, stackSource: 'user' }
}

/** The user changes a scale field. Who owns the stack does not change. */
export function withScaleChange(raw: ManagementDeploymentInputs, patch: Partial<ManagementDeploymentInputs>): ManagementDeploymentInputs {
  return { ...raw, ...patch, stackSource: raw.stackSource ?? 'advisor' }
}

/** The management inputs for the design, by the rule at the top of this file. */
export function resolveManagementInputs(args: {
  stored: ManagementDeploymentInputs | null | undefined
  answers: AdvisorAnswers | null | undefined
  contextNodes: number
  includedVmCount: number
}): ResolvedManagementInputs {
  const answers = args.answers ?? {}
  const recommendation = recommendManagementPlane(answers)
  const answeredCount = Object.values(answers).filter((answer) => answer !== undefined).length
  const ready = advisorStackFields(recommendation)
  const stored = args.stored ? { ...args.stored, monitoring: args.stored.monitoring ?? 'none' } : null
  const base: ManagementDeploymentInputs = stored ?? deploymentInputsFromStack([], args.contextNodes, args.includedVmCount)
  const followsAdvisor = !stored || stored.stackSource === 'advisor'

  let inputs: ManagementDeploymentInputs
  let source: ManagementInputsSource
  if (!followsAdvisor) {
    inputs = base
    source = 'saved'
  } else if (ready) {
    inputs = { ...base, ...ready, stackSource: 'advisor', arcServices: ready.includeArc ? base.arcServices : [] }
    source = 'advisor'
  } else {
    inputs = { ...base, ...startingPointStackFields(recommendation, answers, args.contextNodes), stackSource: 'advisor' }
    source = 'starting-point'
  }

  const differences = ready ? differencesFrom(inputs, ready) : []
  return {
    inputs,
    source,
    advisor: {
      answers,
      answeredCount,
      status: answeredCount === 0 ? 'not-started' : recommendation.status,
      recommendation,
      recommendedStack: recommendation.status === 'ready' ? describeRecommendedStack(recommendation) : 'Not final: the advisor is not complete',
      matches: ready ? differences.length === 0 : null,
      differences,
    },
  }
}

/** One sentence on how the deployment relates to the advisor, for pages and the report. */
export function advisorMatchSentence(source: ManagementInputsSource, advisor: ManagementAdvisorSummary): string {
  if (advisor.status === 'not-started') {
    return 'The Management Plane Advisor was not answered, so the deployment stack is a starting point based on the host count, not a recommendation.'
  }
  if (advisor.status === 'conflict') {
    return `The advisor answers conflict, so there is no recommendation. ${source === 'saved' ? 'The deployment keeps the saved choices.' : 'The deployment stack is a starting point, not a recommendation.'}`
  }
  if (advisor.status === 'incomplete') {
    return `The advisor is incomplete (${advisor.recommendation.unansweredDecisionIds.length} question${advisor.recommendation.unansweredDecisionIds.length === 1 ? '' : 's'} still needed). ${source === 'saved' ? 'The deployment keeps the saved choices.' : 'The deployment stack is a starting point, not a recommendation.'}`
  }
  return advisor.matches
    ? `The deployment matches the advisor recommendation: ${advisor.recommendedStack}.`
    : `The deployment does not match the advisor recommendation (${advisor.recommendedStack}). ${advisor.differences.join(' ')}`
}
