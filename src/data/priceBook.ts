/**
 * Every list price the cost model uses, with the date it was checked, where it comes from and how
 * sure the tool is of it (audit E11).
 *
 * verified: read on a Microsoft or Azure page, or in the Azure Retail Prices API, on the date given.
 * unverified: a reseller, analyst or tool figure. The Cost Model tab still offers it as an editable
 * starting value, but the solution report shows "quote required" instead of a price.
 *
 * skuRef ties an entry to the Sources & SKUs catalog (skuReference). skuDivisor converts the catalog
 * price to the unit used here, such as a 16-core license to a 2-core pack (8). A test checks both agree.
 */
export type PriceConfidence = 'verified' | 'unverified'

export interface PriceEntry {
  value: number
  unit: string
  label: string
  checked: string
  source: string
  confidence: PriceConfidence
  note: string
  skuRef?: string
  skuDivisor?: number
}

export const PRICES_CHECKED = '2026-11-05'
const WS_PRICING = 'https://www.microsoft.com/en-us/windows-server/pricing'
const SC_PRICING = 'https://www.microsoft.com/en-us/system-center/pricing'
const RETAIL_API = 'https://prices.azure.com/api/retail/prices'
const RESELLER_SPLA = 'https://redresscompliance.com/microsoft-spla-pricing-2026.html'
const CSP_CATALOG = 'https://o365hq.com/license/CSP-DG7GMGF0PP47-0003'

function entry(value: number, unit: string, label: string, source: string, confidence: PriceConfidence, note: string, skuRef?: string, skuDivisor?: number): PriceEntry {
  return { value, unit, label, checked: PRICES_CHECKED, source, confidence, note, ...(skuRef ? { skuRef } : {}), ...(skuDivisor ? { skuDivisor } : {}) }
}

export const PRICE_ENTRIES = {
  windowsPerTwoCorePack: entry(6_771 / 8, 'per 2-core pack', 'Windows Server 2025 Datacenter', WS_PRICING, 'verified',
    'Suggested MSRP $6,771 per 16-core license, divided by 8. Unlimited virtual OSEs once every core is licensed.', 'WS-DC-16', 8),
  windowsStandardPerTwoCorePack: entry(1_176 / 8, 'per 2-core pack', 'Windows Server 2025 Standard', WS_PRICING, 'verified',
    'Suggested MSRP $1,176 per 16-core license, divided by 8. Each full licensing of a host covers 2 virtual OSEs.', 'WS-STD-16', 8),
  windowsSplaPerTwoCorePackMonth: entry(25, 'per 2-core pack per month', 'Windows Server Datacenter (SPLA)', RESELLER_SPLA, 'unverified',
    'SPLA prices come from your SPLA reseller. Reseller midpoint only.', 'WS-DC-SPLA'),
  windowsStandardSplaPerTwoCorePackMonth: entry(5, 'per 2-core pack per month', 'Windows Server Standard (SPLA)', RESELLER_SPLA, 'unverified',
    'Reseller midpoint only.', 'WS-STD-SPLA'),
  windowsPaygPerCoreMonth: entry(33.58, 'per core per month', 'Windows Server pay-as-you-go enabled by Azure Arc', WS_PRICING, 'verified',
    '$0.046 per core per hour. Same rate for Standard and Datacenter, with no core minimum (learn.microsoft.com/azure/azure-arc/servers/billing-windows-server-pay-go).', 'WS-PAYG', 1),
  windowsCalPerUnit: entry(0, 'per user or device', 'Windows Server CAL', WS_PRICING, 'unverified',
    'Microsoft publishes no CAL list price. Enter your quoted price.'),
  systemCenterPerTwoCorePack: entry(3_968 / 8, 'per 2-core pack', 'System Center 2025 Datacenter', SC_PRICING, 'verified',
    'Suggested MSRP $3,968 for a 16-core server, divided by 8. Manages any number of OSEs.', 'SC-DC-16', 8),
  systemCenterStandardPerTwoCorePack: entry(1_455 / 8, 'per 2-core pack', 'System Center 2025 Standard', SC_PRICING, 'verified',
    'Suggested MSRP $1,455 for a 16-core server, divided by 8. Manages up to two OSEs per license.', 'SC-STD-16', 8),
  systemCenterSplaPerTwoCorePackMonth: entry(21, 'per 2-core pack per month', 'System Center Datacenter (SPLA)', RESELLER_SPLA, 'unverified',
    'Reseller midpoint only.', 'SC-DC-SPLA'),
  systemCenterStandardSplaPerTwoCorePackMonth: entry(6.5, 'per 2-core pack per month', 'System Center Standard (SPLA)', RESELLER_SPLA, 'unverified',
    'Reseller midpoint only.', 'SC-STD-SPLA'),
  systemCenterStandardCspOneYearPerTwoCorePack: entry(57, 'per 2-core pack per year', 'System Center Standard (CSP, 1 year)', CSP_CATALOG, 'unverified',
    'Reseller catalog. Confirm in Partner Center.', 'SC-STD-CSP1'),
  systemCenterStandardCspThreeYearPerTwoCorePack: entry(143, 'per 2-core pack per 3 years', 'System Center Standard (CSP, 3 years)', CSP_CATALOG, 'unverified',
    'Reseller catalog. Confirm in Partner Center.', 'SC-STD-CSP3'),
  sqlStandardPerCore: entry(1_859, 'per core', 'SQL Server Standard (per core)', 'https://redresscompliance.com/sql-server-2022-licensing-a-comprehensive-guide', 'unverified',
    'Third-party compiled list price. Used only when you license SQL Server separately.', 'SQL-STD-CORE'),
  sqlStandardSplaPerTwoCorePackMonth: entry(0, 'per 2-core pack per month', 'SQL Server Standard (SPLA)', RESELLER_SPLA, 'unverified',
    'No sourced price. Enter your SPLA reseller price.'),
  rdsSalPerUserMonth: entry(6.5, 'per user per month', 'RDS SAL (SPLA)', RESELLER_SPLA, 'unverified',
    'Reseller midpoint only.', 'RDS-SAL'),
  rdsCalPerUser: entry(129.99, 'per user', 'RDS User CAL', 'https://www.cdw.com/product/microsoft-windows-server-2025-remote-desktop-services-license-1-user-ca/8143188', 'unverified',
    'Single reseller listing.', 'WS-CAL-RDS'),
  softwareAssuranceAnnualRate: entry(0.25, 'of the license price per year', 'Software Assurance', 'https://upperedge.com/microsoft/microsoft-software-assurance-big-risk-for-a-small-reward/', 'unverified',
    'TOOL assumption from analyst sources. Microsoft does not publish an SA percentage.'),
  azureLocalPerCoreMonth: entry(10, 'per physical core per month', 'Azure Local host service fee', 'https://azure.microsoft.com/pricing/details/azure-local/', 'verified',
    'Azure Retail Prices API lists $0.33 per core per day (about $10 a month). Billed on physical cores; no core minimum is stated.', 'AZL-HOST', 1),
  updateManagerPerVmMonth: entry(5, 'per server per month', 'Azure Update Manager (Arc-enabled server)', RETAIL_API, 'verified',
    'Retail Prices API meter "Basic Server", $5 per month, prorated daily.', 'AUM', 1),
  defenderP2PerVmMonth: entry(0.02 * 730, 'per server per month', 'Defender for Servers Plan 2', RETAIL_API, 'verified',
    '$0.02 per server per hour (meter "Standard P2 Node") × 730 hours.', 'DEF-P2', 1),
  guestConfigPerVmMonth: entry(6, 'per server per month', 'Azure Machine Configuration (Arc-enabled server)', RETAIL_API, 'verified',
    'Retail Prices API meter "Guest Configuration Policy/Server", $6 per month.', 'GUESTCFG', 1),
  changeTrackingPerVmMonth: entry(6, 'per server per month', 'Change Tracking and Inventory (Arc-enabled server)', RETAIL_API, 'verified',
    'Retail Prices API meter "Non-Azure Node Server", $6 per month.'),
  logAnalyticsPerGb: entry(2.3, 'per GB', 'Log Analytics (Analytics Logs ingestion)', 'https://azure.microsoft.com/pricing/details/monitor/', 'verified',
    'Retail Prices API $2.30 per GB. The first 5 GB per billing account per month is free.', 'LAW-GB', 1),
} satisfies Record<string, PriceEntry>

export type PriceKey = keyof typeof PRICE_ENTRIES

/** Plain numbers for the rate card. */
export const PRICE_BOOK = Object.fromEntries(Object.entries(PRICE_ENTRIES).map(([key, value]) => [key, value.value])) as Record<PriceKey, number>

/** Free Log Analytics ingestion: 5 GB per billing account per month (azure.microsoft.com/pricing/details/monitor). */
export const LOG_ANALYTICS_FREE_GB_PER_MONTH = 5
