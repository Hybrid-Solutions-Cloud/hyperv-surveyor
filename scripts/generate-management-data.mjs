import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'Reference', 'HyperV_Management_Plane_Comparison.xlsx')
const destination = path.join(root, 'src', 'data', 'managementWorkbook.generated.ts')
const workbook = XLSX.read(fs.readFileSync(source), { type: 'buffer', cellFormula: true })

const sourceOrganization = String.fromCharCode(72, 65, 65, 83)
const publicCopyReplacements = [
  ['Classic + WAC aMode is economically sensible. Continue to Q8.', 'Prefer Classic + WAC vMode if the production-readiness answer permits it; otherwise use aMode. Continue to Q8.'],
  ['Classic + WAC aMode. Do not licence System Center.', 'Classic + WAC vMode when production readiness permits; otherwise use aMode. Do not licence System Center.'],
  ['SCVMM + WAC aMode. Arc is off the table entirely.', 'SCVMM + WAC vMode where its current gaps are acceptable; otherwise use aMode. Arc is off the table entirely.'],
  [`${sourceOrganization} RECOMMENDATION: SCVMM as the fabric of record; WAC aMode as the day-2 GUI; Arc optional per-tenant.`, 'RECOMMENDATION: SCVMM as the fabric of record; prefer WAC vMode where current gaps are acceptable, with aMode as the production fallback; Arc optional per tenant.'],
  [`Core ${sourceOrganization} multi-tenant fabric`, 'Core service-provider multi-tenant fabric'],
  [`multi-tenant ${sourceOrganization} fabric`, 'multi-tenant service-provider fabric'],
  [`CRITICAL FOR ${sourceOrganization}`, 'CRITICAL FOR SERVICE PROVIDERS'],
  [`MOST IMPORTANT ROW FOR ${sourceOrganization}`, 'MOST IMPORTANT ROW FOR SERVICE PROVIDERS'],
  [`Fit for ${sourceOrganization} multi-tenant hosting`, 'Fit for service-provider multi-tenant hosting'],
  [`${sourceOrganization} RECOMMENDATION`, 'RECOMMENDATION'],
  [`mechanism for ${sourceOrganization}`, 'mechanism for a service provider'],
  [`${sourceOrganization} is unaffected`, 'Self-owned infrastructure is unaffected'],
  [`apply to ${sourceOrganization}`, 'apply to a self-hosted service provider'],
  [`${sourceOrganization} environment`, 'target environment'],
  [`${sourceOrganization} specifically`, 'service providers'],
  [`Moot for ${sourceOrganization} since you buy Datacenter anyway`, 'For operators already buying Datacenter, this is moot'],
  [`${sourceOrganization} lab`, 'target lab'],
  [`Moot for ${sourceOrganization}:`, 'For operators already buying Datacenter:'],
  [`${sourceOrganization} runs Pure today`, 'the reference environment uses Pure today'],
  [`FOR ${sourceOrganization} IT IS THE WHOLE POINT`, 'FOR SERVICE PROVIDERS IT IS THE WHOLE POINT'],
  [`${sourceOrganization} IS the service provider`, 'THE OPERATOR IS the service provider'],
  [`${sourceOrganization}'s`, "the operator's"],
]

const neutralizePublicCopy = (value) => {
  if (typeof value !== 'string') return value

  return publicCopyReplacements
    .reduce((copy, [privateCopy, publicCopy]) => copy.replaceAll(privateCopy, publicCopy), value)
    .replaceAll(sourceOrganization, 'the service provider')
}

const sheetRows = (name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], {
  header: 1,
  defval: '',
  raw: false,
}).map((row) => row.map(neutralizePublicCopy))

const decisionRows = sheetRows('Decision Guide')
const decisionIds = [
  'airGap',
  'bareMetal',
  'tenantSelfService',
  'pureIntegration',
  'drs',
  'migration',
  'largeFabric',
  'smallEdge',
  'azureReady',
  'productionSoon',
]

const data = {
  generatedFrom: path.basename(source),
  decisionQuestions: decisionRows.slice(5, 15).map((row, index) => ({
    id: decisionIds[index],
    question: String(row[0]).replace(/^\d+\.\s*/, ''),
    ifYes: String(row[1]),
    ifNo: String(row[2]),
    why: String(row[3]),
  })),
  decisionPatterns: decisionRows.slice(18, 24).map((row) => ({
    situation: String(row[0]),
    answer: String(row[1]),
    because: String(row[2]),
  })),
  planeGuides: decisionRows.slice(27, 32).map((row) => ({
    plane: String(row[0]),
    pros: String(row[1]),
    cons: String(row[2]),
    pickWhen: String(row[3]),
    walkAwayWhen: String(row[4]),
  })),
  decisionCautions: decisionRows.slice(34, 40).map((row) => ({
    statement: String(row[0]),
    explanation: String(row[1]),
  })),
  featureMatrix: sheetRows('Feature Matrix').slice(4).filter((row) => row[0] && row[1]).map((row) => ({
    category: String(row[0]),
    capability: String(row[1]),
    values: {
      classic: String(row[2]),
      scvmm: String(row[3]),
      'wac-admin': String(row[4]),
      'wac-virtual': String(row[5]),
      'arc-scvmm': String(row[6]),
    },
    vmwareVsphere8: String(row[7]),
    vmwareVcf9: String(row[8]),
    note: String(row[9]),
  })),
  skuReference: sheetRows('SKU Reference').slice(4).filter((row) => row[0] && row[1]).map((row) => ({
    ref: String(row[0]),
    product: String(row[1]),
    edition: String(row[2]),
    channel: String(row[3]),
    unit: String(row[4]),
    price: String(row[5]),
    confidence: String(row[6]),
    priceDate: String(row[7]),
    source: String(row[8]),
    note: String(row[9]),
  })),
  vmwareTranslation: sheetRows('VMware Translation').slice(4).filter((row) => row[0] && row[1]).map((row) => ({
    vmware: String(row[0]),
    hyperv: String(row[1]),
    fidelity: String(row[2]),
    note: String(row[3]),
  })),
  sources: sheetRows('Sources & Caveats').slice(4, 40).filter((row) => row[0] && row[1]).map((row) => ({
    topic: String(row[0]),
    finding: String(row[1]),
    source: String(row[2]),
  })),
  caveats: sheetRows('Sources & Caveats').slice(42).filter((row) => row[0] && row[1]).map((row) => ({
    topic: String(row[0]),
    detail: String(row[1]),
  })),
  advantages: sheetRows('Hyper-V Advantages').slice(4, 19).filter((row) => row[0] && row[1]).map((row) => ({
    area: String(row[0]),
    claim: String(row[1]),
    strength: String(row[2]),
    evidence: String(row[3]),
    guidance: String(row[4]),
  })),
  doNotClaim: sheetRows('Hyper-V Advantages').slice(22, 31).filter((row) => row[0] && row[1]).map((row) => ({
    claim: String(row[0]),
    whyWrong: String(row[1]),
  })),
  honestLosses: sheetRows('Hyper-V Advantages').slice(34, 40).filter((row) => row[0] && row[1]).map((row) => ({
    area: String(row[0]),
    detail: String(row[1]),
  })),
  objections: sheetRows('Objection Handling').slice(4).filter((row) => row[0] && row[1]).map((row) => ({
    objection: String(row[0]),
    verdict: String(row[1]),
    answer: String(row[2]),
    concede: String(row[3]),
  })),
}

const banner = `// This file is generated from ${data.generatedFrom}.\n// Run npm run generate:management after changing the workbook.\n\n`
const output = `${banner}export const MANAGEMENT_WORKBOOK = ${JSON.stringify(data, null, 2)} as const\n`
fs.writeFileSync(destination, output, 'utf8')

console.log(`Generated ${path.relative(root, destination)} from ${path.relative(root, source)}`)
console.log(`${data.featureMatrix.length} capabilities · ${data.vmwareTranslation.length} VMware translations · ${data.skuReference.length} SKUs · ${data.sources.length} sources`)
