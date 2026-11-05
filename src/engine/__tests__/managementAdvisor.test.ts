/**
 * Phase 4: the advisor result reaches the deployment inputs by one rule (audit D1, D5, D6, D8), and
 * the management plan follows Microsoft limits and prerequisites (D2, D3, D4, D9, D11, D13).
 * Synthetic data only.
 */
import { describe, expect, it } from 'vitest'
import type { AdvisorAnswers } from '../../data/managementPlane'
import {
  applyAdvisorResult,
  resolveManagementInputs,
  withScaleChange,
  withStackChoice,
} from '../managementAdvisor'
import {
  deploymentInputsFromStack,
  normalizeManagementDeploymentInputs,
  planManagementDeployment,
  SCOM_LIMITS,
  type ManagementDeploymentInputs,
} from '../managementDeployment'
import { resolvePlatformDesign } from '../platformDesign'
import { DEFAULT_CONFIG, DEFAULT_PROPOSED_CONFIG, defaultTiers, newVm } from '../../state/defaults'

/** SCVMM + WAC aMode + SCOM monitoring + Arc, HA on. */
const scvmmAnswers: AdvisorAnswers = {
  airGap: false, bareMetal: true, tenantSelfService: false, azureServices: true, scomFeatures: false,
  monitoring: true, pureIntegration: false, drs: false, largeFabric: false, wacSoftwareDefinedFabric: false,
  vmodeHostEligible: true, azureReady: true, gaRequired: true, managementHa: true,
}

const base = (overrides: Partial<ManagementDeploymentInputs> = {}): ManagementDeploymentInputs => ({
  ...deploymentInputsFromStack(['scvmm', 'wac-admin'], 20, 600),
  ...overrides,
})

describe('D1 the stack follows the advisor until the user picks it', () => {
  it('uses a ready advisor result when the user has never edited the deployment', () => {
    const resolved = resolveManagementInputs({ stored: null, answers: scvmmAnswers, contextNodes: 3, includedVmCount: 40 })
    expect(resolved.source).toBe('advisor')
    expect(resolved.inputs).toMatchObject({ foundation: 'scvmm', wac: 'wac-admin', monitoring: 'scom', includeArc: true, fabricHighAvailability: true })
    expect(resolved.advisor.matches).toBe(true)
  })

  it('keeps following the advisor after scale edits, such as managed hosts', () => {
    const scaled = withScaleChange(base(), { managedHosts: 120 })
    const resolved = resolveManagementInputs({ stored: scaled, answers: scvmmAnswers, contextNodes: 0, includedVmCount: 0 })
    expect(resolved.source).toBe('advisor')
    expect(resolved.inputs.managedHosts).toBe(120)
    expect(resolved.inputs.includeArc).toBe(true)
  })

  it('keeps user stack choices and reports how the advisor now differs', () => {
    const chosen = withStackChoice(base(), { foundation: 'classic', monitoring: 'none' })
    const resolved = resolveManagementInputs({ stored: chosen, answers: scvmmAnswers, contextNodes: 3, includedVmCount: 40 })
    expect(resolved.source).toBe('saved')
    expect(resolved.inputs.foundation).toBe('classic')
    expect(resolved.advisor.matches).toBe(false)
    expect(resolved.advisor.differences.join(' ')).toMatch(/Foundation is Classic Hyper-V tools; the advisor recommends SCVMM 2025/)
    expect(resolved.advisor.differences.join(' ')).toMatch(/SCOM is no SCOM/)
  })

  it('treats saves from before this change as the user\'s choice', () => {
    const legacy = { ...base(), stackSource: undefined }
    expect(resolveManagementInputs({ stored: legacy, answers: scvmmAnswers, contextNodes: 3, includedVmCount: 40 }).source).toBe('saved')
  })
})

describe('D8 Apply advisor result keeps the scale fields', () => {
  it('changes only the stack', () => {
    const stored = withStackChoice(base({
      managedHosts: 64, managedVms: 2_400, managedClusters: 5, managementPlacement: 'dedicated-management-cluster',
      scomWarehouseRetentionDays: 800, scomOperationalRetentionDays: 14, libraryContentGiB: 3_000, arcRegion: 'Example region',
      arcServices: ['update-manager'],
    }), { foundation: 'classic', includeArc: false })
    const applied = applyAdvisorResult(stored, resolveManagementInputs({ stored, answers: scvmmAnswers, contextNodes: 0, includedVmCount: 0 }).advisor.recommendation)
    expect(applied).toMatchObject({
      foundation: 'scvmm', monitoring: 'scom', includeArc: true, stackSource: 'advisor',
      managedHosts: 64, managedVms: 2_400, managedClusters: 5, managementPlacement: 'dedicated-management-cluster',
      scomWarehouseRetentionDays: 800, scomOperationalRetentionDays: 14, libraryContentGiB: 3_000, arcRegion: 'Example region',
      arcServices: ['update-manager'],
    })
    expect(resolveManagementInputs({ stored: applied, answers: scvmmAnswers, contextNodes: 0, includedVmCount: 0 }).advisor.matches).toBe(true)
  })
})

describe('D5 Classic never removes Arc', () => {
  it('keeps Azure Arc-enabled servers and their services when Classic is picked', () => {
    const withArc = base({ includeArc: true, arcServices: ['update-manager', 'defender-for-servers'] })
    const classic = withStackChoice(withArc, { foundation: 'classic' })
    expect(classic.includeArc).toBe(true)
    expect(classic.arcServices).toEqual(['update-manager', 'defender-for-servers'])
    expect(planManagementDeployment(classic).arcServices.length).toBe(3)
  })
})

describe('D6 an incomplete advisor never silently becomes a stack', () => {
  it('shows a labelled starting point and never claims to match', () => {
    const resolved = resolveManagementInputs({ stored: null, answers: { bareMetal: true }, contextNodes: 3, includedVmCount: 20 })
    expect(resolved.source).toBe('starting-point')
    expect(resolved.advisor.status).toBe('incomplete')
    expect(resolved.advisor.matches).toBeNull()
    expect(resolved.advisor.recommendedStack).toMatch(/not complete/)
    // The confirmed SCVMM foundation is used, even though 3 hosts would otherwise start from Classic.
    expect(resolved.inputs.foundation).toBe('scvmm')
  })

  it('keeps the user\'s choice while the advisor is incomplete', () => {
    const chosen = withStackChoice(base(), { foundation: 'classic', wac: 'none' })
    const resolved = resolveManagementInputs({ stored: chosen, answers: { bareMetal: true }, contextNodes: 3, includedVmCount: 20 })
    expect(resolved.source).toBe('saved')
    expect(resolved.inputs).toMatchObject({ foundation: 'classic', wac: 'none' })
  })

  it('uses the host-count starting point when nothing is answered', () => {
    expect(resolveManagementInputs({ stored: null, answers: {}, contextNodes: 4, includedVmCount: 20 }).inputs.foundation).toBe('classic')
    expect(resolveManagementInputs({ stored: null, answers: {}, contextNodes: 5, includedVmCount: 20 }).inputs.foundation).toBe('scvmm')
  })
})

describe('D2 SCOM daily data follows the managed estate', () => {
  it('recalculates when hosts or VMs change, until the user sets it', () => {
    const scom = base({ monitoring: 'scom', managedHosts: 0, managedVms: 0 })
    expect(normalizeManagementDeploymentInputs(scom).scomDailyDataGiB).toBe(1)
    const grown = withScaleChange(scom, { managedHosts: 100, managedVms: 4_900 })
    expect(normalizeManagementDeploymentInputs(grown)).toMatchObject({ scomDailyDataGiB: 10, scomDailyDataUserSet: false })
    const userSet = withScaleChange(grown, { scomDailyDataGiB: 3 })
    const regrown = withScaleChange(userSet, { managedVms: 20_000 })
    expect(normalizeManagementDeploymentInputs(regrown)).toMatchObject({ scomDailyDataGiB: 3, scomDailyDataUserSet: true })
    expect(normalizeManagementDeploymentInputs(withScaleChange(regrown, { scomDailyDataGiB: undefined })).scomDailyDataUserSet).toBe(false)
  })

  it('sizes features-only SCOM from hosts and VMM servers, not every VM', () => {
    const features = planManagementDeployment(base({ monitoring: 'scom-features', managedHosts: 100, managedVms: 5_000, scomHighAvailability: true }))
    expect(features.scomAgentManagedComputers).toBe(102)
    const sql = features.components.find((item) => item.id === 'scom-sql')!
    // 1 GiB/day x (7 + 400) days x 1.25 + 200 = 709 GiB, so the 1,000 GiB medium profile applies.
    expect(sql.diskGiB).toBe(1_000)
  })
})

describe('D3 SCOM limits from Microsoft', () => {
  it('warns (MS-REC, not blocking) above the 15,000 Recommended Limit for one management group', () => {
    const plan = planManagementDeployment(base({ monitoring: 'scom', scomHighAvailability: true, managedHosts: 900, managedVms: 20_000 }))
    expect(plan.scomAgentManagedComputers).toBe(20_900)
    expect(plan.errors).toEqual([])
    expect(plan.cautions.join(' ')).toMatch(/\[MS-REC\] SCOM: 20,900 .*15,000 Microsoft lists as the Recommended Limit/)
    expect(plan.cautions.join(' ')).toMatch(/system-requirements\?view=sc-om-2025/)
    expect(SCOM_LIMITS.agentsPerManagementGroupWith25Consoles).toBe(15_000)
  })

  it('warns between 6,000 and 15,000 agents', () => {
    const plan = planManagementDeployment(base({ monitoring: 'scom', scomHighAvailability: true, managedHosts: 200, managedVms: 8_000 }))
    expect(plan.errors).toEqual([])
    expect(plan.cautions.join(' ')).toMatch(/\[MS-REC\].*above the 6,000 Microsoft lists as the Recommended Limit for one management group with 50 open consoles/)
  })

  it('warns (MS-REC) on a single SCOM server above 3,000 agents and beyond small estates', () => {
    const big = planManagementDeployment(base({ monitoring: 'scom', scomHighAvailability: false, managedHosts: 200, managedVms: 10_000 }))
    expect(big.errors).toEqual([])
    expect(big.cautions.join(' ')).toMatch(/\[MS-REC\] SCOM single server: .*3,000 Microsoft lists as the Recommended Limit for one management server/)
    const medium = planManagementDeployment(base({ monitoring: 'scom', scomHighAvailability: false, managedHosts: 60, managedVms: 900 }))
    expect(medium.errors).toEqual([])
    expect(medium.cautions.join(' ')).toMatch(/single-server topology is planned for a medium estate/)
    const small = planManagementDeployment(base({ monitoring: 'scom', scomHighAvailability: false, managedHosts: 8, managedVms: 200 }))
    expect(small.cautions.join(' ')).not.toMatch(/is planned for a/)
  })
})

describe('D4 vMode prerequisites in the bill of materials', () => {
  it('lists the host prerequisites and the installer certificate behavior', () => {
    const plan = planManagementDeployment(base({ foundation: 'classic', wac: 'wac-virtual' }))
    const text = plan.dependencies.join(' ')
    expect(text).toMatch(/Windows Server 2025 or later, Datacenter edition only/)
    expect(text).toMatch(/same domain as the Virtualization Mode gateway/)
    expect(text).toMatch(/Network ATC, Data Center Bridging, Hyper-V, and Failover Clustering/)
    expect(text).toMatch(/rolling reboot/)
    expect(text).toMatch(/self-signed certificate that expires after 60 days/)
    expect(plan.components.find((item) => item.id === 'wac-virtual')!.notes.join(' ')).toMatch(/60 days/)
  })

  it('cautions that SCVMM and vMode on the same hosts must be validated', () => {
    expect(planManagementDeployment(base({ wac: 'wac-virtual' })).cautions.join(' ')).toMatch(/not a documented fact|Validate before relying on it/)
  })
})

describe('D11 and D13 plan wording', () => {
  it('does not offer a load balancer for the SCOM web console', () => {
    const plan = planManagementDeployment(base({ monitoring: 'scom', scomHighAvailability: true, scomAuxiliaryRecovery: 'warm-standby' }))
    const web = plan.components.find((item) => item.id === 'scom-web')!
    expect(web.availability).toMatch(/DNS alias change, no load balancer/)
    expect(web.notes.join(' ')).toMatch(/does not support Network Load Balancing/)
  })

  it('lists the SCOM SQL Server minimums from Microsoft', () => {
    const ha = planManagementDeployment(base({ monitoring: 'scom', scomHighAvailability: true }))
    const single = planManagementDeployment(base({ monitoring: 'scom', scomHighAvailability: false }))
    for (const plan of [ha, single]) expect(plan.dependencies.join(' ')).toMatch(/SQL Server 2022 with Cumulative Update 11 \(CU11\) or later, or SQL Server 2019 with Cumulative Update 8 \(CU8\)/)
    expect(ha.components.find((item) => item.id === 'scom-sql')!.notes.join(' ')).toMatch(/CU11/)
    expect(single.components.find((item) => item.id === 'scom-all-in-one')!.notes.join(' ')).toMatch(/CU8/)
  })

  it('records management packs and clusters without changing sizing', () => {
    const plan = (overrides: Partial<ManagementDeploymentInputs>) => planManagementDeployment(base({ monitoring: 'scom', scomHighAvailability: true, ...overrides }))
    const few = plan({ scomManagementPackCount: 5, managedClusters: 1 })
    const many = plan({ scomManagementPackCount: 200, managedClusters: 20 })
    expect(many.totalVCpu).toBe(few.totalVCpu)
    expect(many.totalDiskGiB).toBe(few.totalDiskGiB)
    expect(many.cautions.join(' ')).toMatch(/recorded for the Sizing Helper and do not change this estimate/)
  })
})

describe('D9 management-only dedicated placement', () => {
  const design = (inputs: ManagementDeploymentInputs | null, answers: AdvisorAnswers = {}) => resolvePlatformDesign({
    engagementMode: 'management-only',
    cfg: structuredClone(DEFAULT_PROPOSED_CONFIG),
    tiers: defaultTiers(),
    vms: [newVm({ name: 'SYN1' })],
    chosenKey: 'san',
    existingCapacityCfg: structuredClone(DEFAULT_CONFIG),
    managementDecision: 'design',
    managementDeploymentInputs: inputs,
    includeManagementInSizing: true,
    managementAdvisorAnswers: answers,
  })

  it('gives a host count from the reference server', () => {
    const result = design(base({ managedHosts: 40, managedVms: 1_200, managementPlacement: 'dedicated-management-cluster' }))
    expect(result.management.dedicated?.nodes).toBeGreaterThanOrEqual(2)
    expect(result.management.dedicated?.basis).toMatch(/reference server/)
    expect(result.management.warnings).toEqual([])
  })

  it('warns when managed hosts or VMs are 0', () => {
    const result = design(base({ managedHosts: 0, managedVms: 0, managementPlacement: 'dedicated-management-cluster' }))
    expect(result.management.warnings.join(' ')).toMatch(/Managed hosts are 0/)
    expect(result.management.warnings.join(' ')).toMatch(/Managed workload VMs are 0/)
  })

  it('surfaces SCOM Recommended Limit warnings on the design without blocking it', () => {
    const result = design(withStackChoice(base({ managedHosts: 900, managedVms: 20_000 }), { monitoring: 'scom', scomHighAvailability: true }))
    expect(result.management.errors.join(' ')).not.toMatch(/15,000/)
    expect(result.management.plan.cautions.join(' ')).toMatch(/\[MS-REC\].*15,000/)
  })
})
