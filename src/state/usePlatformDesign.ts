import { useMemo } from 'react'
import { resolvePlatformDesign, type PlatformDesign, type PlatformDesignInputs } from '../engine/platformDesign'
import type { ManagementDeploymentInputs } from '../engine/managementDeployment'
import { useSurveyorStore, type SurveyorState } from './store'
import type { EngagementMode } from './journey'

type DesignState = Pick<SurveyorState,
  'engagementMode' | 'cfg' | 'tiers' | 'vms' | 'chosenKey' | 'existingCapacityCfg' | 'existingCapacityTiers'
  | 'existingCapacityNodes' | 'placementInputs' | 'managementDecision' | 'managementDeploymentInputs' | 'includeManagementInSizing'>

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
    placementInputs: state.placementInputs,
    managementDecision: state.managementDecision,
    managementDeploymentInputs: state.managementDeploymentInputs,
    includeManagementInSizing: state.includeManagementInSizing,
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
  const placementInputs = useSurveyorStore((state) => state.placementInputs)
  const managementDecision = useSurveyorStore((state) => state.managementDecision)
  const storedManagement = useSurveyorStore((state) => state.managementDeploymentInputs)
  const includeManagementInSizing = useSurveyorStore((state) => state.includeManagementInSizing)
  const overridden = managementOverride !== undefined
  const managementDeploymentInputs = overridden ? managementOverride : storedManagement
  return useMemo(() => resolvePlatformDesign(platformDesignInputs({
    engagementMode, cfg, tiers, vms, chosenKey, existingCapacityCfg, existingCapacityTiers, existingCapacityNodes,
    placementInputs,
    managementDecision: overridden ? 'design' : managementDecision,
    managementDeploymentInputs,
    includeManagementInSizing,
  })), [engagementMode, cfg, tiers, vms, chosenKey, existingCapacityCfg, existingCapacityTiers, existingCapacityNodes, placementInputs, managementDecision, managementDeploymentInputs, includeManagementInSizing, overridden])
}
