/**
 * Provider economics on top of the licensing estimate. The old calculatePlaneCost scenarios were
 * replaced in Phase 7: they priced SQL inside System Center rights, SA from year 2, and Datacenter
 * on every design (audit E1, E4, E6). The licensing rules are tested in licensing.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { calculateProviderEconomics } from '../managementCost'
import { countVms, DEFAULT_COST_MODEL_INPUTS, estimateLicensing, type CostModelInputs, type LicensingQuantities } from '../licensing'
import { newVm } from '../../state/defaults'

const vms = Array.from({ length: 320 }, (_, i) => newVm({ name: `SYN${i}`, vCpu: 4, ramGiB: 16, storageGiB: 100, guestOs: 'Windows Server 2022' }))
const quantities: LicensingQuantities = {
  path: 'new-platform', engagementMode: 'new-platform', status: 'ready', reason: null, label: 'Test', realVms: 320, windowsClaim: true, validationNote: null,
  design: { plane: 'scvmm', systemCenter: true, scom: false, arc: false, arcMeters: { updateManager: false, defenderP2: false, machineConfig: false, changeTracking: false, logAnalytics: false }, arcGuestScopePct: 100, sqlCores: 8 },
  scopes: [{
    id: 'w', label: 'Workload cluster', role: 'workload', priced: true, architecture: 'san',
    hostLines: [{ label: '2 × 32 cores', hosts: 9, sockets: 2, coresPerSocket: 32, physicalCoresPerHost: 64, licensableCoresPerHost: 64 }],
    hosts: 9, spareHosts: 1, workloadHosts: 8, physicalCores: 576, licensableCores: 576, vms: countVms(vms), windowsVmsPerHost: 40, managedOsesPerHost: 40, note: null,
  }],
}
const inputs = (commercial: Partial<CostModelInputs['commercial']> = {}, patch: Partial<CostModelInputs> = {}): CostModelInputs => ({
  ...structuredClone(DEFAULT_COST_MODEL_INPUTS),
  ...patch,
  commercial: { ...DEFAULT_COST_MODEL_INPUTS.commercial, ...commercial },
})

describe('provider economics', () => {
  it('Internal TCO has no revenue and costs the licensing estimate plus delivery', () => {
    const model = inputs()
    const estimate = estimateLicensing(quantities, model)
    const result = calculateProviderEconomics('scvmm', estimate, model)
    expect(result.totalRevenue).toBe(0)
    expect(result.softwareCost).toBeCloseTo(estimate.total, 2)
  })

  it('models CSP discount, resale markup and Lighthouse guidance', () => {
    const model = inputs({ motion: 'csp', microsoftDiscountPct: 10, licenseMarkupPct: 10, tenantCount: 2 })
    const estimate = estimateLicensing(quantities, model)
    const result = calculateProviderEconomics('scvmm', estimate, model)
    expect(result.softwareCost).toBeCloseTo(estimate.total * 0.9, 2)
    expect(result.licenseRevenue).toBeCloseTo(result.softwareCost * 1.1, 2)
    expect(result.recommendations.some((item) => item.title.includes('Lighthouse'))).toBe(true)
  })

  it('shows when MSP fees do not recover cost at the target margin', () => {
    const model = inputs({ motion: 'msp', monthlyManagedFeePerVm: 1, monthlyPlatformFeePerTenant: 0 }, { basis: 'spla' })
    const result = calculateProviderEconomics('scvmm', estimateLicensing(quantities, model), model)
    expect(result.revenueGap).toBeGreaterThan(0)
    expect(result.recommendations.some((item) => item.title.includes('below the target'))).toBe(true)
  })

  it('flags perpetual licensing for a provider-hosted MSP service', () => {
    const model = inputs({ motion: 'msp' })
    const result = calculateProviderEconomics('scvmm', estimateLicensing(quantities, model), model)
    expect(result.recommendations.some((item) => item.detail.includes('provider-hosted service normally needs SPLA'))).toBe(true)
  })

  it('counts RDS access as monthly SALs under SPLA and one-time CALs otherwise', () => {
    const spla = inputs({}, { basis: 'spla', rds: { inScope: true, users: 10 } })
    const perpetual = inputs({}, { rds: { inScope: true, users: 10 } })
    expect(calculateProviderEconomics('classic', estimateLicensing(quantities, spla), spla).accessLicensingCost).toBeCloseTo(10 * 6.5 * 36, 2)
    expect(calculateProviderEconomics('classic', estimateLicensing(quantities, perpetual), perpetual).accessLicensingCost).toBeCloseTo(10 * 129.99, 2)
  })
})
