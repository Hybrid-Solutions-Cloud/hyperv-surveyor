import { describe, expect, it } from 'vitest'
import {
  deploymentComponentsToVms,
  deploymentInputsFromStack,
  normalizeManagementDeploymentInputs,
  planManagementDeployment,
  type ManagementDeploymentInputs,
} from '../managementDeployment'

const base: ManagementDeploymentInputs = {
  foundation: 'scvmm',
  wac: 'wac-admin',
  includeArc: false,
  monitoring: 'none',
  highAvailability: false,
  fabricHighAvailability: false,
  scomHighAvailability: false,
  scomSqlPlacement: 'dedicated',
  arcServices: [],
  managedHosts: 24,
  managedVms: 800,
  managedClusters: 3,
  libraryContentGiB: 500,
  includeIdentityServices: false,
}

describe('management deployment planner', () => {
  it('builds the standalone VMM, SQL, library, and WAC footprint', () => {
    const plan = planManagementDeployment(base)
    expect(plan.scale).toBe('small')
    expect(plan.components.map((item) => item.id)).toEqual(['vmm', 'sql', 'library', 'library-content', 'wac-admin'])
    expect(plan.totalInstances).toBe(4)
    expect(plan.totalVCpu).toBe(40)
    expect(plan.totalRamGiB).toBe(48)
  })

  it('turns the supported components into HA pairs', () => {
    const plan = planManagementDeployment({ ...base, fabricHighAvailability: true })
    expect(plan.components.find((item) => item.id === 'vmm')?.count).toBe(2)
    expect(plan.components.find((item) => item.id === 'sql')?.count).toBe(2)
    expect(plan.components.find((item) => item.id === 'library')?.count).toBe(2)
    expect(plan.components.find((item) => item.id === 'wac-admin')?.count).toBe(2)
    expect(plan.totalInstances).toBe(8)
  })

  it('does not invent HA for Virtualization Mode preview', () => {
    const plan = planManagementDeployment({ ...base, wac: 'wac-virtual', fabricHighAvailability: true })
    expect(plan.components.find((item) => item.id === 'wac-virtual')?.count).toBe(1)
    expect(plan.cautions.some((item) => item.includes('not published an HA'))).toBe(true)
  })

  it('requires SCVMM before adding Arc', () => {
    const plan = planManagementDeployment({ ...base, foundation: 'classic', includeArc: true })
    expect(plan.components.some((item) => item.id === 'arc-bridge')).toBe(false)
    expect(plan.cautions.some((item) => item.includes('requires SCVMM'))).toBe(true)
  })

  it('models Arc resource bridge as one separate steady-state appliance VM', () => {
    const plan = planManagementDeployment({ ...base, includeArc: true })
    const bridge = plan.components.find((item) => item.id === 'arc-bridge')
    expect(bridge).toMatchObject({ count: 1, vCpu: 4, ramGiB: 32, diskGiB: 100 })
    expect(bridge?.notes.some((item) => item.includes('separate on-premises appliance VM'))).toBe(true)
    expect(bridge?.notes.some((item) => item.includes('second appliance VM IP'))).toBe(true)
    expect(plan.arcServices.map((service) => service.id)).toEqual(['core-management'])
  })

  it('adds selected Arc guest services without inventing more appliance VMs', () => {
    const plan = planManagementDeployment({ ...base, includeArc: true, arcServices: ['update-manager', 'azure-monitor'] })
    expect(plan.arcServices.map((service) => service.id)).toEqual(['core-management', 'update-manager', 'azure-monitor'])
    expect(plan.components.filter((item) => item.id === 'arc-bridge')).toHaveLength(1)
    expect(plan.dependencies.some((item) => item.includes('Connected Machine agent'))).toBe(true)
  })

  it('maps the deployment to infrastructure VMs for capacity impact', () => {
    const plan = planManagementDeployment({ ...base, fabricHighAvailability: true })
    const vms = deploymentComponentsToVms(plan.components)
    expect(vms).toHaveLength(8)
    expect(vms.every((vm) => vm.tier === 'infrastructure' && vm.include)).toBe(true)
  })

  it('combines SCOM roles on one server when SCOM HA is not selected', () => {
    const plan = planManagementDeployment({ ...base, monitoring: 'scom' })
    expect(plan.components.map((item) => item.id)).toEqual([
      'vmm',
      'sql',
      'library',
      'library-content',
      'wac-admin',
      'scom-all-in-one',
    ])
    expect(plan.components.find((item) => item.id === 'scom-all-in-one')).toMatchObject({ count: 1, vCpu: 16, ramGiB: 48 })
    expect(plan.totalInstances).toBe(5)
    expect(plan.cautions.some((item) => item.includes('smallest production loads'))).toBe(true)
  })

  it('makes SCOM management and database roles redundant when HA is selected', () => {
    const plan = planManagementDeployment({ ...base, monitoring: 'scom', scomHighAvailability: true })
    expect(plan.components.find((item) => item.id === 'scom-management')?.count).toBe(2)
    expect(plan.components.find((item) => item.id === 'scom-sql')?.count).toBe(2)
    expect(plan.components.find((item) => item.id === 'scom-reporting')?.count).toBe(1)
    expect(plan.components.find((item) => item.id === 'scom-web')?.count).toBe(1)
    expect(plan.cautions.some((item) => item.includes('rebuild recovery'))).toBe(true)
  })

  it('can add warm standby recovery for SCOM reporting and web roles', () => {
    const plan = planManagementDeployment({ ...base, monitoring: 'scom', scomHighAvailability: true, scomAuxiliaryRecovery: 'warm-standby' })
    expect(plan.components.find((item) => item.id === 'scom-reporting')?.count).toBe(2)
    expect(plan.components.find((item) => item.id === 'scom-web')?.count).toBe(2)
  })

  it('sizes SCOM database allowance from daily collection and retention', () => {
    const plan = planManagementDeployment({ ...base, monitoring: 'scom', scomHighAvailability: true, scomDailyDataGiB: 20, scomWarehouseRetentionDays: 800 })
    expect(plan.components.find((item) => item.id === 'scom-sql')?.diskGiB).toBeGreaterThan(20_000)
  })

  it('records Arc private connectivity, region, and scoped guest services', () => {
    const plan = planManagementDeployment({ ...base, includeArc: true, arcServices: ['azure-monitor'], arcConnectivity: 'private-link', arcRegion: 'East US 2', arcGuestScopePct: 25 })
    expect(plan.dependencies.some((item) => item.includes('Private Link Scope'))).toBe(true)
    expect(plan.dependencies.some((item) => item.includes('East US 2'))).toBe(true)
    expect(plan.dependencies.some((item) => item.includes('approximately 200 VMs'))).toBe(true)
  })

  it('can share the VMM SQL Always On infrastructure with SCOM databases', () => {
    const plan = planManagementDeployment({
      ...base,
      monitoring: 'scom',
      fabricHighAvailability: true,
      scomHighAvailability: true,
      scomSqlPlacement: 'shared-vmm',
    })
    const sharedSql = plan.components.find((item) => item.id === 'sql')
    expect(sharedSql).toMatchObject({ name: 'Shared SQL Server for VMM and SCOM databases', count: 2, vCpu: 32, ramGiB: 48 })
    expect(sharedSql?.availability).toContain('Shared SQL Always On')
    expect(plan.components.some((item) => item.id === 'scom-sql')).toBe(false)
  })

  it('requires fabric HA before sharing the VMM SQL Always On infrastructure', () => {
    const plan = planManagementDeployment({
      ...base,
      monitoring: 'scom',
      scomHighAvailability: true,
      scomSqlPlacement: 'shared-vmm',
    })
    expect(plan.components.find((item) => item.id === 'sql')?.count).toBe(1)
    expect(plan.components.find((item) => item.id === 'scom-sql')?.count).toBe(2)
    expect(plan.cautions.some((item) => item.includes('requires SCVMM / WAC high availability'))).toBe(true)
  })

  it('keeps fabric and SCOM availability choices independent', () => {
    const scomHaOnly = planManagementDeployment({ ...base, monitoring: 'scom', scomHighAvailability: true })
    expect(scomHaOnly.components.find((item) => item.id === 'vmm')?.count).toBe(1)
    expect(scomHaOnly.components.find((item) => item.id === 'scom-management')?.count).toBe(2)
    expect(scomHaOnly.components.find((item) => item.id === 'scom-sql')?.count).toBe(2)

    const fabricHaOnly = planManagementDeployment({ ...base, monitoring: 'scom', fabricHighAvailability: true })
    expect(fabricHaOnly.components.find((item) => item.id === 'vmm')?.count).toBe(2)
    expect(fabricHaOnly.components.find((item) => item.id === 'scom-all-in-one')?.count).toBe(1)
  })

  it('scales SCOM management servers at the published 3,000-agent limit', () => {
    const plan = planManagementDeployment({ ...base, monitoring: 'scom', scomHighAvailability: true, managedHosts: 500, managedVms: 6_000 })
    expect(plan.components.find((item) => item.id === 'scom-management')?.count).toBe(3)
  })

  it('uses an advisor stack as the initial deployment choice', () => {
    const inputs = deploymentInputsFromStack(
      ['scvmm', 'wac-virtual', 'arc-scvmm'],
      12,
      600,
      { monitoring: 'scom', highAvailability: false },
    )
    expect(inputs.foundation).toBe('scvmm')
    expect(inputs.wac).toBe('wac-virtual')
    expect(inputs.includeArc).toBe(true)
    expect(inputs.monitoring).toBe('scom')
    expect(inputs.highAvailability).toBe(false)
    expect(inputs.fabricHighAvailability).toBe(false)
    expect(inputs.scomHighAvailability).toBe(false)
    expect(inputs.scomSqlPlacement).toBe('dedicated')
    expect(inputs.arcServices).toEqual([])
  })

  it('migrates the legacy global HA choice into both independent choices', () => {
    const legacy = normalizeManagementDeploymentInputs({
      ...base,
      fabricHighAvailability: undefined,
      scomHighAvailability: undefined,
      highAvailability: true,
    })
    expect(legacy.fabricHighAvailability).toBe(true)
    expect(legacy.scomHighAvailability).toBe(true)
  })
})
