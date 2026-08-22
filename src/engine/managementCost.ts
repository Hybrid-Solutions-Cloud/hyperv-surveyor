import { PRICE_BOOK, type PlaneId } from '../data/managementPlane'

export type LicenseModel = 'perpetual' | 'spla'
export type CommercialMotion = 'internal' | 'csp' | 'msp'
export type RecommendationTone = 'good' | 'warn' | 'action'

export interface ManagementCostInputs {
  hosts: number
  sockets: number
  coresPerSocket: number
  vms: number
  spareHosts: number
  termYears: number
  sqlCores: number
  /** SCOM independently requires System Center licensing even when SCVMM is not selected. */
  includeScom?: boolean
  /** Guest-service billing scope. Core Arc projection remains separate and free. */
  arcEnabledVms?: number
  waiveUpdateAndGuest: boolean
  includeUpdateManager: boolean
  includeDefenderP2: boolean
  includeGuestConfig: boolean
  includeLogAnalytics: boolean
  logAnalyticsGbPerVm: number
  model: LicenseModel
}

export interface ManagementRateCard {
  windowsPerTwoCorePack: number
  windowsSplaPerTwoCorePackMonth: number
  systemCenterPerTwoCorePack: number
  systemCenterSplaPerTwoCorePackMonth: number
  systemCenterStandardCspOneYearPerTwoCorePack: number
  systemCenterStandardCspThreeYearPerTwoCorePack: number
  sqlStandardPerCore: number
  rdsSalPerUserMonth: number
  rdsCalPerUser: number
  softwareAssuranceAnnualRate: number
  updateManagerPerVmMonth: number
  defenderP2PerVmMonth: number
  guestConfigPerVmMonth: number
  logAnalyticsPerGb: number
}

export const DEFAULT_MANAGEMENT_RATE_CARD: ManagementRateCard = {
  windowsPerTwoCorePack: PRICE_BOOK.windowsPerTwoCorePack,
  windowsSplaPerTwoCorePackMonth: PRICE_BOOK.windowsSplaPerTwoCorePackMonth,
  systemCenterPerTwoCorePack: PRICE_BOOK.systemCenterPerTwoCorePack,
  systemCenterSplaPerTwoCorePackMonth: PRICE_BOOK.systemCenterSplaPerTwoCorePackMonth,
  systemCenterStandardCspOneYearPerTwoCorePack: PRICE_BOOK.systemCenterStandardCspOneYearPerTwoCorePack,
  systemCenterStandardCspThreeYearPerTwoCorePack: PRICE_BOOK.systemCenterStandardCspThreeYearPerTwoCorePack,
  sqlStandardPerCore: PRICE_BOOK.sqlStandardPerCore,
  rdsSalPerUserMonth: PRICE_BOOK.rdsSalPerUserMonth,
  rdsCalPerUser: PRICE_BOOK.rdsCalPerUser,
  softwareAssuranceAnnualRate: PRICE_BOOK.softwareAssuranceAnnualRate,
  updateManagerPerVmMonth: PRICE_BOOK.updateManagerPerVmMonth,
  defenderP2PerVmMonth: PRICE_BOOK.defenderP2PerVmMonth,
  guestConfigPerVmMonth: PRICE_BOOK.guestConfigPerVmMonth,
  logAnalyticsPerGb: PRICE_BOOK.logAnalyticsPerGb,
}

export interface ManagementPlaneCost {
  total: number
  managementOnly: number
  perVmMonth: number
  effectiveVms: number
  windows: number
  systemCenter: number
  sql: number
  azure: number
  azurePerVmMonth: number
}

export interface CommercialInputs {
  motion: CommercialMotion
  tenantCount: number
  rdsUsers: number
  microsoftDiscountPct: number
  licenseMarkupPct: number
  azureMarkupPct: number
  onboardingDeliveryCostPerTenant: number
  onboardingFeePerTenant: number
  monthlyPlatformFeePerTenant: number
  monthlyManagedFeePerVm: number
  monthlyOpsCostPerVm: number
  monthlySharedOpsCost: number
  targetGrossMarginPct: number
  useLighthouse: boolean
}

export interface CommercialRecommendation {
  tone: RecommendationTone
  title: string
  detail: string
}

export interface ProviderEconomics {
  softwareCost: number
  azureCost: number
  accessLicensingCost: number
  deliveryCost: number
  totalProviderCost: number
  licenseRevenue: number
  azureRevenue: number
  serviceRevenue: number
  totalRevenue: number
  grossProfit: number
  grossMarginPct: number
  targetRevenue: number
  revenueGap: number
  requiredMonthlyPerVmIncrease: number
  customerPerTenantMonth: number
  customerPerVmMonth: number
  recommendations: CommercialRecommendation[]
}

export function calculatePlaneCost(
  plane: PlaneId,
  inputs: ManagementCostInputs,
  rateCard: ManagementRateCard = DEFAULT_MANAGEMENT_RATE_CARD,
): ManagementPlaneCost {
  const coresPerHost = Math.max(inputs.sockets * inputs.coresPerSocket, inputs.sockets * 8, 16)
  const packsPerHost = Math.ceil(coresPerHost / 2)
  const months = Math.max(1, inputs.termYears * 12)
  const needsSystemCenter = plane === 'scvmm' || plane === 'arc-scvmm' || inputs.includeScom === true

  const windowsBase = inputs.model === 'perpetual'
    ? inputs.hosts * packsPerHost * rateCard.windowsPerTwoCorePack
    : inputs.hosts * packsPerHost * rateCard.windowsSplaPerTwoCorePackMonth * months
  const windows = inputs.model === 'perpetual'
    ? windowsBase * (1 + rateCard.softwareAssuranceAnnualRate * Math.max(inputs.termYears - 1, 0))
    : windowsBase

  const systemCenterBase = !needsSystemCenter
    ? 0
    : inputs.model === 'perpetual'
      ? inputs.hosts * packsPerHost * rateCard.systemCenterPerTwoCorePack
      : inputs.hosts * packsPerHost * rateCard.systemCenterSplaPerTwoCorePackMonth * months
  const systemCenter = inputs.model === 'perpetual'
    ? systemCenterBase * (1 + rateCard.softwareAssuranceAnnualRate * Math.max(inputs.termYears - 1, 0))
    : systemCenterBase
  const sqlBase = needsSystemCenter ? inputs.sqlCores * rateCard.sqlStandardPerCore : 0
  // SQL is included conservatively until System Center runtime rights are confirmed.
  const sql = inputs.model === 'perpetual'
    ? sqlBase * (1 + rateCard.softwareAssuranceAnnualRate * Math.max(inputs.termYears - 1, 0))
    : sqlBase
  const azurePerVmMonth = (
    (inputs.includeUpdateManager && !inputs.waiveUpdateAndGuest ? rateCard.updateManagerPerVmMonth : 0)
    + (inputs.includeDefenderP2 ? rateCard.defenderP2PerVmMonth : 0)
    + (inputs.includeGuestConfig && !inputs.waiveUpdateAndGuest ? rateCard.guestConfigPerVmMonth : 0)
    + (inputs.includeLogAnalytics ? inputs.logAnalyticsGbPerVm * rateCard.logAnalyticsPerGb : 0)
  )
  const arcEnabledVms = Math.min(inputs.vms, Math.max(0, inputs.arcEnabledVms ?? inputs.vms))
  const azure = plane === 'arc-scvmm' ? arcEnabledVms * azurePerVmMonth * months : 0
  const managementOnly = systemCenter + sql + azure
  const total = windows + managementOnly
  const effectiveHosts = Math.max(1, inputs.hosts - Math.min(inputs.spareHosts, Math.max(0, inputs.hosts - 1)))
  const effectiveVms = Math.max(1, inputs.vms * effectiveHosts / Math.max(1, inputs.hosts))

  return {
    total,
    managementOnly,
    perVmMonth: total / effectiveVms / months,
    effectiveVms,
    windows,
    systemCenter,
    sql,
    azure,
    azurePerVmMonth,
  }
}

export function calculateProviderEconomics(
  plane: PlaneId,
  planeCost: ManagementPlaneCost,
  management: ManagementCostInputs,
  commercial: CommercialInputs,
  rateCard: ManagementRateCard = DEFAULT_MANAGEMENT_RATE_CARD,
): ProviderEconomics {
  const months = Math.max(1, management.termYears * 12)
  const tenants = Math.max(1, commercial.tenantCount)
  const managedVms = Math.max(1, management.vms)
  const discount = Math.min(toRate(commercial.microsoftDiscountPct), 1)
  const licenseMarkup = toRate(commercial.licenseMarkupPct)
  const azureMarkup = toRate(commercial.azureMarkupPct)
  const targetMargin = Math.min(toRate(commercial.targetGrossMarginPct), 0.95)

  const softwareCost = (planeCost.windows + planeCost.systemCenter + planeCost.sql) * (1 - discount)
  const azureCost = planeCost.azure * (1 - discount)
  const accessListCost = management.model === 'spla'
    ? Math.max(0, commercial.rdsUsers) * rateCard.rdsSalPerUserMonth * months
    : Math.max(0, commercial.rdsUsers) * rateCard.rdsCalPerUser
  const accessLicensingCost = accessListCost * (1 - discount)
  const deliveryCost = (
    Math.max(0, commercial.monthlyOpsCostPerVm) * managedVms * months
    + Math.max(0, commercial.monthlySharedOpsCost) * months
    + Math.max(0, commercial.onboardingDeliveryCostPerTenant) * tenants
  )
  const totalProviderCost = softwareCost + azureCost + accessLicensingCost + deliveryCost

  const isCommercial = commercial.motion !== 'internal'
  const isCsp = commercial.motion === 'csp'
  const licenseRevenue = isCsp ? (softwareCost + accessLicensingCost) * (1 + licenseMarkup) : 0
  const azureRevenue = isCsp ? azureCost * (1 + azureMarkup) : 0
  const serviceRevenue = isCommercial ? (
    Math.max(0, commercial.onboardingFeePerTenant) * tenants
    + Math.max(0, commercial.monthlyPlatformFeePerTenant) * tenants * months
    + Math.max(0, commercial.monthlyManagedFeePerVm) * managedVms * months
  ) : 0
  const totalRevenue = licenseRevenue + azureRevenue + serviceRevenue
  const grossProfit = totalRevenue - totalProviderCost
  const grossMarginPct = totalRevenue > 0 ? grossProfit / totalRevenue : 0
  const targetRevenue = totalProviderCost / Math.max(0.05, 1 - targetMargin)
  const revenueGap = Math.max(0, targetRevenue - totalRevenue)
  const requiredMonthlyPerVmIncrease = revenueGap / managedVms / months
  const customerPerTenantMonth = totalRevenue / tenants / months
  const customerPerVmMonth = totalRevenue / managedVms / months

  return {
    softwareCost,
    azureCost,
    accessLicensingCost,
    deliveryCost,
    totalProviderCost,
    licenseRevenue,
    azureRevenue,
    serviceRevenue,
    totalRevenue,
    grossProfit,
    grossMarginPct,
    targetRevenue,
    revenueGap,
    requiredMonthlyPerVmIncrease,
    customerPerTenantMonth,
    customerPerVmMonth,
    recommendations: buildCommercialRecommendations(
      plane,
      management,
      commercial,
      grossMarginPct,
      targetMargin,
      revenueGap,
      requiredMonthlyPerVmIncrease,
    ),
  }
}

function buildCommercialRecommendations(
  plane: PlaneId,
  management: ManagementCostInputs,
  commercial: CommercialInputs,
  grossMargin: number,
  targetMargin: number,
  revenueGap: number,
  requiredMonthlyPerVmIncrease: number,
): CommercialRecommendation[] {
  const recommendations: CommercialRecommendation[] = []

  if (commercial.motion === 'internal') {
    recommendations.push({
      tone: 'action',
      title: 'Choose a commercial route before quoting',
      detail: 'Internal TCO intentionally excludes customer revenue. Select CSP managed customer or MSP hosted platform to build a sell price and margin model.',
    })
  }

  if (commercial.motion === 'msp' && management.model !== 'spla') {
    recommendations.push({
      tone: 'warn',
      title: 'Validate hosted licensing rights',
      detail: 'A provider-hosted multi-tenant service normally needs SPLA or another explicit service-provider right. Do not assume customer-owned perpetual or CSP subscriptions cover the hosted platform.',
    })
  }

  if (commercial.motion === 'csp' && management.model === 'spla') {
    recommendations.push({
      tone: 'warn',
      title: 'The channel and licensing basis conflict',
      detail: 'CSP models customer-owned subscriptions and Azure consumption; SPLA is provider-owned hosting COGS. Select the route that matches the contract and invoicing owner.',
    })
  }

  if (commercial.motion === 'csp') {
    recommendations.push(commercial.useLighthouse
      ? {
          tone: 'good',
          title: 'Lighthouse is included as a no-license-cost operating control',
          detail: 'Use Azure Lighthouse delegation for cross-tenant administration, then price the managed service work separately. Arc and Azure consumption remain billable.',
        }
      : {
          tone: 'action',
          title: 'Add Azure Lighthouse for cross-tenant operations',
          detail: 'Lighthouse does not replace CSP billing, Arc, or your management platform, but it reduces credential sharing and supports delegated multi-customer operations.',
        })
  }

  if (commercial.tenantCount > 1 && ['classic', 'wac-admin', 'wac-virtual'].includes(plane)) {
    recommendations.push({
      tone: 'action',
      title: 'Use a centralized fabric plane for multi-tenant operations',
      detail: 'SCVMM provides placement, templates, logical networking, delegation, and fabric-wide control that host-by-host tooling does not provide.',
    })
  }

  if (plane === 'wac-virtual') {
    recommendations.push({
      tone: 'warn',
      title: 'Treat WAC virtual-mode capability as preview-sensitive',
      detail: 'Confirm the current support statement and required build before making it the production operating model; retain a supported fallback.',
    })
  }

  if (plane === 'scvmm' || plane === 'arc-scvmm') {
    recommendations.push({
      tone: 'action',
      title: 'Confirm System Center SQL runtime rights',
      detail: 'This estimate includes SQL Server Standard conservatively. Remove that line only after licensing confirms the applicable System Center SQL runtime entitlement and deployment boundaries.',
    })
  }

  if (commercial.rdsUsers > 0) {
    recommendations.push({
      tone: 'action',
      title: management.model === 'spla' ? 'RDS access is modeled as monthly SALs' : 'RDS access is modeled as perpetual user CALs',
      detail: management.model === 'spla'
        ? 'Reconcile subscribers monthly and confirm the current distributor SPLA rate; SALs are provider-reported operating cost.'
        : 'Confirm whether User or Device CALs fit the access pattern and whether Software Assurance or external connector rights are required.',
    })
  }

  if (commercial.microsoftDiscountPct === 0 && commercial.motion !== 'internal') {
    recommendations.push({
      tone: 'action',
      title: 'Replace list estimates with your channel quote',
      detail: 'Enter the effective Partner Center or distributor discount. CSP NCE, SPLA, incentives, region, and agreement terms can materially change provider COGS.',
    })
  }

  if (commercial.motion !== 'internal') {
    recommendations.push(revenueGap > 0
      ? {
          tone: 'warn',
          title: 'Pricing is below the target gross margin',
          detail: `Add at least ${formatCurrency(requiredMonthlyPerVmIncrease)} per managed VM per month, or an equivalent tenant/platform fee, to reach the ${(targetMargin * 100).toFixed(0)}% target.`,
        }
      : {
          tone: 'good',
          title: 'The modeled price clears the margin target',
          detail: `Modeled gross margin is ${(grossMargin * 100).toFixed(1)}% against a ${(targetMargin * 100).toFixed(0)}% target. Validate utilization, support effort, bad debt, and taxes before quoting.`,
        })
  }

  recommendations.push({
    tone: 'action',
    title: 'Allocate N+n capacity deliberately',
    detail: `The cost base licenses all ${management.hosts} hosts, while per-VM economics use workload-bearing capacity after N+${management.spareHosts}. Decide whether spare capacity is recovered through platform fees, per-VM rates, or a reserved-capacity charge.`,
  })

  if (commercial.motion === 'csp' && (plane === 'scvmm' || plane === 'arc-scvmm')) {
    recommendations.push({
      tone: 'warn',
      title: 'Do not substitute System Center Standard CSP reference pricing',
      detail: 'The workbook’s one- and three-year CSP NCE references are System Center Standard, which covers only two managed OSEs per fully licensed host. Dense virtualization usually needs Datacenter economics and verified CSP availability.',
    })
  }

  return recommendations
}

function toRate(value: number) {
  return Math.max(0, value / 100)
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}
