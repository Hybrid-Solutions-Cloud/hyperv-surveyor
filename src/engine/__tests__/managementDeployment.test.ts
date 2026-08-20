import { describe, expect, it } from 'vitest'
import {
  deploymentComponentsToVms,
  deploymentInputsFromStack,
  planManagementDeployment,
  type ManagementDeploymentInputs,
} from '../managementDeployment'

const base: ManagementDeploymentInputs = {
  foundation: 'scvmm',
  wac: 'wac-admin',
  includeArc: false,
  monitoring: 'none',
  highAvailability: false,
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
    const plan = planManagementDeployment({ ...base, highAvailability: true })
    expect(plan.components.find((item) => item.id === 'vmm')?.count).toBe(2)
    expect(plan.components.find((item) => item.id === 'sql')?.count).toBe(2)
    expect(plan.components.find((item) => item.id === 'library')?.count).toBe(2)
    expect(plan.components.find((item) => item.id === 'wac-admin')?.count).toBe(2)
    expect(plan.totalInstances).toBe(8)
  })

  it('does not invent HA for Virtualization Mode preview', () => {
    const plan = planManagementDeployment({ ...base, wac: 'wac-virtual', highAvailability: true })
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
  })

  it('maps the deployment to infrastructure VMs for capacity impact', () => {
    const plan = planManagementDeployment({ ...base, highAvailability: true })
    const vms = deploymentComponentsToVms(plan.components)
    expect(vms).toHaveLength(8)
    expect(vms.every((vm) => vm.tier === 'infrastructure' && vm.include)).toBe(true)
  })

  it('adds a workload-sized SCOM monitoring deployment', () => {
    const plan = planManagementDeployment({ ...base, monitoring: 'scom' })
    expect(plan.components.map((item) => item.id)).toEqual([
      'vmm',
      'sql',
      'library',
      'library-content',
      'wac-admin',
      'scom-management',
      'scom-sql',
      'scom-reporting',
      'scom-web',
    ])
    expect(plan.components.find((item) => item.id === 'scom-management')?.count).toBe(1)
    expect(plan.totalInstances).toBe(8)
  })

  it('makes SCOM management and database roles redundant when HA is selected', () => {
    const plan = planManagementDeployment({ ...base, monitoring: 'scom', highAvailability: true })
    expect(plan.components.find((item) => item.id === 'scom-management')?.count).toBe(2)
    expect(plan.components.find((item) => item.id === 'scom-sql')?.count).toBe(2)
    expect(plan.components.find((item) => item.id === 'scom-reporting')?.count).toBe(1)
    expect(plan.components.find((item) => item.id === 'scom-web')?.count).toBe(1)
    expect(plan.cautions.some((item) => item.includes('reporting and web console roles remain single'))).toBe(true)
  })

  it('scales SCOM management servers at the published 3,000-agent limit', () => {
    const plan = planManagementDeployment({ ...base, monitoring: 'scom', managedHosts: 500, managedVms: 6_000 })
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
  })
})
