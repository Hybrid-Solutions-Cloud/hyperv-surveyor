/**
 * Advisor to report (audit D1). The advisor answers reach the deployment inputs, the Implementation
 * plan data and the report through resolvePlatformDesign, without editing a deployment field, on
 * every planning path. Synthetic data only.
 */
import { describe, expect, it } from 'vitest'
import { buildSolutionReport, type SolutionReport } from './reportModel'
import { resolvePlatformDesign } from '../engine/platformDesign'
import { platformDesignInputs } from '../state/usePlatformDesign'
import { DEFAULT_CONFIG, DEFAULT_PROPOSED_CONFIG, defaultTiers, newVm } from '../state/defaults'
import { DEFAULT_PLACEMENT_INPUTS } from '../engine/deploymentPlanning'
import { DEFAULT_NETWORK_INPUTS } from '../engine/networkDesign'
import { DEFAULT_DR_INPUTS } from '../engine/drDesign'
import { DEFAULT_REPORT_METADATA, type ProjectPayload } from '../state/project'
import { withScaleChange, withStackChoice } from '../engine/managementAdvisor'
import type { AdvisorAnswers } from '../data/managementPlane'
import type { EngagementMode } from '../state/journey'

/** SCVMM + WAC aMode + SCOM monitoring + Azure Arc-enabled servers, highly available. */
const answers: AdvisorAnswers = {
  airGap: false, bareMetal: true, tenantSelfService: false, azureServices: true, scomFeatures: false,
  monitoring: true, pureIntegration: false, drs: false, largeFabric: false, wacSoftwareDefinedFabric: false,
  vmodeHostEligible: true, azureReady: true, gaRequired: true, managementHa: true,
}

function state(mode: EngagementMode, overrides: Partial<ProjectPayload> = {}): ProjectPayload {
  return {
    engagementMode: mode,
    managementDecision: 'design',
    customerName: 'Synthetic Co',
    vms: Array.from({ length: 40 }, (_, i) => newVm({ name: `SYN${i}`, vCpu: 4, ramGiB: 16, storageGiB: 100 })),
    cfg: structuredClone(DEFAULT_PROPOSED_CONFIG),
    tiers: defaultTiers(),
    chosenKey: 'san',
    existingCapacityCfg: structuredClone(DEFAULT_CONFIG),
    existingCapacityTiers: defaultTiers(),
    existingCapacityNodes: 8,
    managementDeploymentInputs: null,
    managementAdvisorAnswers: answers,
    includeManagementInSizing: true,
    placementInputs: structuredClone(DEFAULT_PLACEMENT_INPUTS),
    networkDesignInputs: structuredClone(DEFAULT_NETWORK_INPUTS),
    drDesignInputs: structuredClone(DEFAULT_DR_INPUTS),
    reportMetadata: structuredClone(DEFAULT_REPORT_METADATA),
    dataSources: [],
    storageDecisionAnswers: {},
    ...overrides,
  }
}

const management = (report: SolutionReport) => report.sections.find((section) => section.id === 'management')!
const metric = (report: SolutionReport, label: string) => management(report).metrics.find((item) => item.label === label)?.value

describe('advisor answers reach the report', () => {
  it.each<EngagementMode>(['management-only', 'new-platform', 'existing-capacity', 'fit-gap'])('on the %s path, with no deployment field edited', (mode) => {
    const payload = state(mode)
    const design = resolvePlatformDesign(platformDesignInputs(payload))
    expect(design.management.source).toBe('advisor')
    expect(design.management.inputs).toMatchObject({ foundation: 'scvmm', wac: 'wac-admin', monitoring: 'scom', includeArc: true, fabricHighAvailability: true })
    expect(design.management.plan.components.some((item) => item.id === 'scom-management')).toBe(true)

    const report = buildSolutionReport({ ...payload, generatedAt: '2026-11-05T00:00:00.000Z' })
    const section = management(report)
    const text = section.paragraphs.join(' ')
    expect(text).toMatch(/SCVMM 2025 \(HA\); WAC Administration Mode; SCOM 2025 HA; Azure Arc-enabled servers/)
    expect(text).toMatch(/Management Plane Advisor: complete\. Recommended stack: SCVMM \+ WAC aMode \+ SCOM 2025 \(monitoring\) \+ Azure Arc-enabled servers, highly available\./)
    expect(text).toMatch(/The deployment matches the advisor recommendation/)
    expect(metric(report, 'Stack source')).toBe('Follows the advisor recommendation')
    expect(metric(report, 'Matches the advisor')).toBe('Yes')
    const answersTable = section.tables.find((table) => table.title === 'Management Plane Advisor answers')!
    expect(answersTable.rows).toHaveLength(Object.keys(answers).length)
    expect(answersTable.rows).toContainEqual([expect.stringMatching(/Windows Server 2025 Datacenter/), 'Yes'])
    expect(answersTable.rows).toContainEqual([expect.stringMatching(/SCOM 2025 as its centralized monitoring platform/), 'Yes'])
  })

  it('states when the deployment no longer matches the advisor', () => {
    const chosen = withStackChoice(withScaleChange({ ...resolvePlatformDesign(platformDesignInputs(state('management-only'))).management.rawInputs }, { managedHosts: 30, managedVms: 600 }), { foundation: 'classic', includeArc: true })
    const report = buildSolutionReport({ ...state('management-only', { managementDeploymentInputs: chosen }), generatedAt: '2026-11-05T00:00:00.000Z' })
    expect(metric(report, 'Matches the advisor')).toBe('No')
    expect(metric(report, 'Stack source')).toBe('Chosen on the Deployment design tab')
    expect(management(report).paragraphs.join(' ')).toMatch(/does not match the advisor recommendation .*Foundation is Classic Hyper-V tools/)
  })

  it('labels an incomplete advisor as a starting point, never a recommendation', () => {
    const report = buildSolutionReport({ ...state('new-platform', { managementAdvisorAnswers: { bareMetal: true } }), generatedAt: '2026-11-05T00:00:00.000Z' })
    expect(metric(report, 'Stack source')).toBe('Starting point, not a recommendation')
    expect(metric(report, 'Matches the advisor')).toMatch(/Not comparable/)
    expect(management(report).paragraphs.join(' ')).toMatch(/advisor is incomplete/)
  })

  it('carries the advisor stack into the Implementation plan management numbers', () => {
    const withAdvisor = resolvePlatformDesign(platformDesignInputs(state('new-platform')))
    const withoutAnswers = resolvePlatformDesign(platformDesignInputs(state('new-platform', { managementAdvisorAnswers: {} })))
    // SCOM HA and Arc come only from the advisor here, so the counted management VMs differ.
    expect(withAdvisor.management.countedVms.length).toBeGreaterThan(withoutAnswers.management.countedVms.length)
    expect(withAdvisor.management.countedVms.some((vm) => vm.name.startsWith('SCOM management server'))).toBe(true)
  })
})
