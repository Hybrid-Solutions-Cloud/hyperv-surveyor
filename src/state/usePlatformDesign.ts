import { useMemo } from 'react'
import { resolvePlatformDesign, withImplementation, type PlatformDesign, type PlatformDesignInputs } from '../engine/platformDesign'
import { buildOptionsMatrix, type OptionsMatrix } from '../engine/optionsMatrix'
import type { ManagementDeploymentInputs } from '../engine/managementDeployment'
import { useSurveyorStore, type SurveyorState } from './store'
import type { EngagementMode } from './journey'

type DesignState = Pick<SurveyorState,
  'engagementMode' | 'cfg' | 'tiers' | 'vms' | 'chosenKey' | 'existingCapacityCfg' | 'existingCapacityTiers'
  | 'existingCapacityNodes' | 'placementInputs' | 'managementDecision' | 'managementDeploymentInputs' | 'includeManagementInSizing'>
  & Partial<Pick<SurveyorState, 'managementAdvisorAnswers' | 'existingHardware' | 'networkDesignInputs' | 'drDesignInputs'>>

/** The planning state the design function reads. Project payloads and saved scenarios have the same fields. */
export function platformDesignInputs(state: DesignState): PlatformDesignInputs {
  return {
    engagementMode: state.engagementMode,
    cfg: state.cfg,
    tiers: state.tiers,
    vms: state.vms,
    chosenKey: state.chosenKey,
    existingCapacityCfg: state.existingCapacityCfg,
    existingCapacityTiers: state.existingCapacityTiers,
    existingCapacityNodes: state.existingCapacityNodes,
    existingHardware: state.existingHardware,
    placementInputs: state.placementInputs,
    managementDecision: state.managementDecision,
    managementDeploymentInputs: state.managementDeploymentInputs,
    includeManagementInSizing: state.includeManagementInSizing,
    managementAdvisorAnswers: state.managementAdvisorAnswers,
    networkDesignInputs: state.networkDesignInputs,
    drDesignInputs: state.drDesignInputs,
  }
}

/**
 * The resolved platform design for the current state. Pass management to see the design a
 * not-yet-saved management choice would give, under the same rules, or engagementMode to read a
 * page that belongs to another path.
 */
export function usePlatformDesign(options: { management?: ManagementDeploymentInputs | null; engagementMode?: EngagementMode } = {}): PlatformDesign {
  const managementOverride = options.management
  const storedMode = useSurveyorStore((state) => state.engagementMode)
  const engagementMode = options.engagementMode ?? storedMode
  const cfg = useSurveyorStore((state) => state.cfg)
  const tiers = useSurveyorStore((state) => state.tiers)
  const vms = useSurveyorStore((state) => state.vms)
  const chosenKey = useSurveyorStore((state) => state.chosenKey)
  const existingCapacityCfg = useSurveyorStore((state) => state.existingCapacityCfg)
  const existingCapacityTiers = useSurveyorStore((state) => state.existingCapacityTiers)
  const existingCapacityNodes = useSurveyorStore((state) => state.existingCapacityNodes)
  const existingHardware = useSurveyorStore((state) => state.existingHardware)
  const placementInputs = useSurveyorStore((state) => state.placementInputs)
  const managementDecision = useSurveyorStore((state) => state.managementDecision)
  const storedManagement = useSurveyorStore((state) => state.managementDeploymentInputs)
  const includeManagementInSizing = useSurveyorStore((state) => state.includeManagementInSizing)
  const managementAdvisorAnswers = useSurveyorStore((state) => state.managementAdvisorAnswers)
  const networkDesignInputs = useSurveyorStore((state) => state.networkDesignInputs)
  const drDesignInputs = useSurveyorStore((state) => state.drDesignInputs)
  const overridden = managementOverride !== undefined
  const managementDeploymentInputs = overridden ? managementOverride : storedManagement
  const base = useMemo(() => resolvePlatformDesign(platformDesignInputs({
    engagementMode, cfg, tiers, vms, chosenKey, existingCapacityCfg, existingCapacityTiers, existingCapacityNodes, existingHardware,
    placementInputs,
    managementDecision: overridden ? 'design' : managementDecision,
    managementDeploymentInputs,
    includeManagementInSizing,
    managementAdvisorAnswers,
  })), [engagementMode, cfg, tiers, vms, chosenKey, existingCapacityCfg, existingCapacityTiers, existingCapacityNodes, existingHardware, placementInputs, managementDecision, managementDeploymentInputs, includeManagementInSizing, managementAdvisorAnswers, overridden])
  // Network and recovery inputs only change the Implementation plan and the bill of materials.
  return useMemo(() => withImplementation(base, { networkDesignInputs, drDesignInputs }), [base, networkDesignInputs, drDesignInputs])
}

/**
 * The options matrix for the new-platform design, built lazily and memoized: it only runs on the
 * pages that call this hook, and only again when an input changes. It uses the same management VMs
 * the resolved design counts.
 */
export function useOptionsMatrix(design: PlatformDesign): OptionsMatrix | null {
  const cfg = useSurveyorStore((state) => state.cfg)
  const tiers = useSurveyorStore((state) => state.tiers)
  const vms = useSurveyorStore((state) => state.vms)
  const answers = useSurveyorStore((state) => state.storageDecisionAnswers)
  const counted = design.management.countedVms
  // The design rebuilds its management VM list on every change; key on its content, not its identity.
  const countedKey = JSON.stringify(counted.map((vm) => [vm.name, vm.tier, vm.vCpu, vm.ramGiB, vm.storageGiB]))
  const enabled = design.path === 'new-platform'
  return useMemo(
    () => enabled ? buildOptionsMatrix({ cfg, vms, tiers, fixedVms: counted, answers }) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, cfg, vms, tiers, answers, countedKey],
  )
}
