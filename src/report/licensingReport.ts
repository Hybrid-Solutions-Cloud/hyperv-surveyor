/**
 * The optional "Licensing (estimate, not a quote)" report section and workbook sheet. Both read the
 * same quantities and estimate the Cost Model tab uses. Order: quantities, editions, products,
 * pricing model and date, totals, alternatives, assumptions, eligibility, then what needs a quote.
 * Sell prices, margins and provider economics never appear here.
 */
import type { ArchitectureOption } from '../engine/solve'
import type { PlatformDesign } from '../engine/platformDesign'
import type { Vm } from '../engine/types'
import {
  basisLabel, estimateLicensing, licensingQuantities, resolveRate,
  type CostModelInputs, type LicensingEstimate, type LicensingLine, type LicensingQuantities,
} from '../engine/licensing'
import type { ReportMetric, ReportTable } from './reportModel'

export const LICENSING_SECTION_TITLE = 'Licensing (estimate, not a quote)'
export const QUOTE_REQUIRED = 'Quote required'

export interface LicensingReportContent {
  title: string
  paragraphs: string[]
  metrics: ReportMetric[]
  tables: ReportTable[]
  quantities: LicensingQuantities
  estimate: LicensingEstimate
}

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 100 ? 2 : 0 })
const n = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 0 })

const CONFIDENCE_LABEL: Record<LicensingLine['confidence'], string> = {
  verified: 'Verified list price',
  unverified: 'Unverified',
  entered: 'Your rate',
  tool: 'TOOL assumption',
  included: 'Included',
}

function pathIntro(quantities: LicensingQuantities): string {
  switch (quantities.engagementMode) {
    case 'existing-capacity': return 'Your entered estate. Current licensing not validated: Surveyor does not know what you already own.'
    case 'fit-gap': return 'Current licensing not validated. Your current hosts are listed for reference; only the hosts you would add are priced.'
    case 'management-only': return 'System Center coverage for the managed hosts you entered. No Windows Server licensing is claimed for them.'
    default: return 'The selected design, including spare hosts, every cluster of a split you chose and a dedicated management cluster.'
  }
}

export function buildLicensingContent(design: PlatformDesign, vms: Vm[], inputs: CostModelInputs, otherOptions: ArchitectureOption[] = []): LicensingReportContent {
  const quantities = licensingQuantities(design, vms)
  const estimate = estimateLicensing(quantities, inputs)
  const paragraphs = [
    `This is an estimate, not a quote. List prices were checked on ${estimate.priceDate}; agreement, region, discounts and date change them. Lines without a verified price show "${QUOTE_REQUIRED}" and are left out of the totals.`,
    pathIntro(quantities),
  ]
  if (quantities.status !== 'ready') {
    return { title: LICENSING_SECTION_TITLE, paragraphs: [...paragraphs, quantities.reason ?? 'Licensing not calculated.'], metrics: [{ label: 'Licensing', value: 'Not calculated', detail: quantities.reason ?? undefined }], tables: [], quantities, estimate }
  }
  const scopes = quantities.scopes
  const priced = scopes.filter((item) => item.priced)
  const windowsEditions = [...new Set(estimate.editions.map((item) => item.windows?.edition).filter(Boolean))]
  const metrics: ReportMetric[] = [
    { label: 'Hosts licensed', value: n(priced.reduce((sum, item) => sum + item.hosts, 0)), detail: priced.map((item) => `${item.label}: ${item.hosts}`).join('; ') || 'Nothing to add' },
    { label: 'Licensable cores', value: n(priced.reduce((sum, item) => sum + item.licensableCores, 0)), detail: 'At least 8 per processor and 16 per server.' },
    { label: 'Windows Server edition', value: quantities.windowsClaim ? windowsEditions.map((edition) => edition === 'datacenter' ? 'Datacenter' : 'Standard').join(' and ') || 'Not priced' : 'Not claimed (management-only)' },
    { label: 'System Center', value: estimate.systemCenterIncluded ? [...new Set(estimate.editions.map((item) => item.systemCenter?.edition).filter(Boolean))].map((edition) => edition === 'datacenter' ? 'Datacenter' : 'Standard').join(' and ') : 'Not selected' },
  ]
  const tables: ReportTable[] = [
    {
      title: 'Quantities',
      headers: ['Scope', 'Hosts', 'Host spec', 'Physical cores per host', 'Licensable cores per host', 'Licensable cores', 'Spare hosts', 'Windows VMs per host', 'Priced'],
      rows: scopes.flatMap((item) => item.hostLines.map((line, index) => [
        index === 0 ? item.label : '',
        n(line.hosts),
        line.label,
        n(line.physicalCoresPerHost),
        n(line.licensableCoresPerHost),
        n(line.hosts * line.licensableCoresPerHost),
        index === 0 ? n(item.spareHosts) : '',
        index === 0 && quantities.windowsClaim ? n(item.windowsVmsPerHost) : '',
        item.priced ? 'Yes' : 'No, reference only',
      ])),
    },
    {
      title: 'Edition and why',
      headers: ['Scope', 'Product', 'Edition', 'Why'],
      rows: estimate.editions.flatMap((item) => [
        ...(item.windows ? [[item.scope, 'Windows Server', item.windows.edition === 'datacenter' ? 'Datacenter' : 'Standard', item.windows.reason]] : []),
        ...(item.systemCenter ? [[item.scope, 'System Center', item.systemCenter.edition === 'datacenter' ? 'Datacenter' : 'Standard', item.systemCenter.reason]] : []),
      ]),
    },
    {
      title: 'Products',
      headers: ['Product', 'Scope', 'Quantity', 'Unit price', 'Price basis', 'Year 1', `Term (${estimate.termYears} yr)`, 'Note'],
      rows: estimate.lines.map((line) => [
        line.product,
        line.scope,
        line.quantity,
        line.quoteRequired ? QUOTE_REQUIRED : line.unitPrice === null ? '' : `${money(line.unitPrice)} ${line.unitLabel}`,
        CONFIDENCE_LABEL[line.confidence],
        line.quoteRequired ? QUOTE_REQUIRED : money(line.years[0] ?? 0),
        line.quoteRequired ? QUOTE_REQUIRED : money(line.total),
        line.note,
      ]),
    },
    {
      title: 'Pricing model and date',
      headers: ['Item', 'Value'],
      rows: [
        ['Licensing basis', basisLabel(estimate.basis)],
        ['Term', `${estimate.termYears} year${estimate.termYears === 1 ? '' : 's'}`],
        ...(estimate.saMultiplier !== null ? [['Software Assurance', `${(resolveRate('softwareAssuranceAnnualRate', inputs.rateOverrides).value * 100).toFixed(0)}% a year from year 1 (TOOL); licenses × ${estimate.saMultiplier.toFixed(2)} over the term`]] : []),
        ['List prices checked', estimate.priceDate],
        ['Currency', 'USD list prices'],
      ],
    },
    {
      title: 'Totals (priced lines only)',
      headers: ['Year', 'Total'],
      rows: [
        ...estimate.pricedPerYear.map((value, index) => [`Year ${index + 1}`, money(value)]),
        [`Term (${estimate.termYears} years)`, money(estimate.pricedTotal)],
        ...(estimate.perVmMonthPriced !== null ? [[`Per workload VM per month (${n(estimate.realVms)} VMs)`, money(estimate.perVmMonthPriced)]] : []),
      ],
    },
  ]
  if (estimate.alternatives.length) {
    tables.push({ title: 'Alternatives, not in the totals', headers: ['Alternative', 'Per year', 'Term', 'How it is counted', 'Source'], rows: estimate.alternatives.map((item) => [item.label, money(item.perYear), money(item.total), item.detail, item.source]) })
  }
  const otherRows = otherOptions
    .filter((option) => option.key !== design.chosen?.key && option.result.feasible)
    .map((option) => [option.label, n(option.result.nodes), n(option.result.totalLicensableCores), option.cfg.architecture === 'san' ? 'Standard or Datacenter' : 'Datacenter (Storage Spaces Direct)'])
  if (quantities.path === 'new-platform' && otherRows.length) {
    tables.push({ title: 'Other designs in this report (one cluster, quantities only)', headers: ['Design', 'Hosts', 'Licensable cores', 'Windows Server edition'], rows: otherRows })
  }
  tables.push({ title: 'Assumptions', headers: ['Assumption'], rows: [...estimate.assumptions, ...estimate.warnings].map((item) => [item]) })
  if (estimate.eligibility.length) {
    tables.push({ title: 'Azure Arc eligibility', headers: ['Service', 'Servers', 'Charged', 'Rule', 'Source'], rows: estimate.eligibility.map((row) => [row.meter, row.servers, row.charged, row.rule, row.source]) })
  }
  tables.push({
    title: 'Quote required',
    headers: ['Product', 'Why'],
    rows: estimate.quoteRequired.length
      ? estimate.quoteRequired.map((line) => [line.product, line.unitPrice !== null && line.unitPrice > 0 ? 'Unverified price: get a quote' : 'No sourced price: get a quote'])
      : [['None', 'Every line has a verified price or your rate.']],
  })
  return { title: LICENSING_SECTION_TITLE, paragraphs: quantities.validationNote ? [...paragraphs, quantities.validationNote] : paragraphs, metrics, tables, quantities, estimate }
}

/** The workbook sheet: the same content, as rows. */
export function licensingSheetRows(content: LicensingReportContent): unknown[][] {
  const rows: unknown[][] = [[content.title], ...content.paragraphs.map((text) => [text]), []]
  if (content.metrics.length) {
    content.metrics.forEach((metric) => rows.push([metric.label, metric.value, metric.detail ?? '']))
    rows.push([])
  }
  for (const table of content.tables) {
    if (table.title) rows.push([table.title])
    rows.push(table.headers)
    table.rows.forEach((row) => rows.push(row))
    rows.push([])
  }
  return rows
}
