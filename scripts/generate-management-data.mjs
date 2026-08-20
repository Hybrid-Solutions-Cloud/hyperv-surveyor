import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'Reference', 'HyperV_Management_Plane_Comparison.xlsx')
const decisionSource = path.join(root, 'Reference', 'management-decision-questions.fact-checked.json')
const destination = path.join(root, 'src', 'data', 'managementWorkbook.generated.ts')
const workbook = XLSX.read(fs.readFileSync(source), { type: 'buffer', cellFormula: true })
const decisionGuide = JSON.parse(fs.readFileSync(decisionSource, 'utf8'))

const sourceOrganization = String.fromCharCode(72, 65, 65, 83)
const publicCopyReplacements = [
  ['SCVMM is the only plane that does bare-metal provisioning, tenant clouds with quotas, Pure array integration and V2V. Those four are table stakes for the business.', 'SCVMM combines bare-metal provisioning, tenant clouds with quotas, array integration, and native offline V2V. Confirm which of those capabilities are steady-state requirements and treat migration as a separate workstream.'],
  ['Add Arc-enabled SCVMM on top as a paid upsell.', 'Add Arc-enabled SCVMM only when Azure portal, ARM, or Azure RBAC management is a stated requirement.'],
  ['The connector is free. You are selling Azure RBAC self-service, Update Manager, Defender and Cost Management — priced per VM per month.', 'Arc projects the SCVMM fabric into Azure. Price each enabled Azure service separately because entitlement, per-resource, and ingestion charges vary.'],
  ['System Center adds ~59% to Microsoft host licensing plus a SQL Server. Indefensible at that size.', 'A small footprint rarely justifies the additional management and database lifecycle by itself, but required capabilities can still justify SCVMM. Model licensing from a current quote.'],
  ['Anything going live before mid-2027', 'Any production design that requires generally available, supported components'],
  ['Public Preview, no HA design, self-signed certs only, no Pure path. Right bet, wrong year.', 'WAC vMode is Preview. Reverify production support, vMode-specific availability, certificate options, and partner integrations before approval.'],
  ['Lab / evaluation track for 2027', 'Lab or evaluation track for WAC vMode'],
  ['Stand up WAC vMode now and re-assess at the 2027 planning cycle.', 'Evaluate WAC vMode in a non-production environment and re-assess at the design approval gate.'],
  ['Gate the re-assessment on four things: GA, a documented HA design, CA certificate support, and a Pure Storage integration path.', 'Gate the re-assessment on GA support, a documented availability design, enterprise certificate support, and required partner integrations.'],
  ['–  ~59% uplift on your Microsoft host licensing, per managed host core', '–  Additional System Center licensing must be priced from the applicable agreement and current quote'],
  ['The only plane with a true DRS equivalent (Dynamic Optimization) and Power Optimization', 'Richer policy-driven compute/storage Dynamic Optimization and host Power Optimization than native Node Fairness'],
  ['Native V2V from VMware, ~4x faster in the 2025 release', 'Native offline V2V from supported VMware versions; Microsoft documents faster conversion beginning with VMM 2022 UR2'],
  ['4. WAC Virtualization Mode\n(vMode — Public Preview 2)', '4. WAC Virtualization Mode\n(vMode — Preview)'],
  ['–  NO Pure Storage integration path today', '–  Partner-extension and Pure Storage compatibility must be verified for the selected release'],
  ['–  NO documented HA design at all, unlike aMode', '–  No vMode-specific HA design is currently documented, unlike aMode'],
  ['–  Self-signed 60-day certificates ONLY; CA certs not yet available', '–  The current vMode installer generates a 60-day self-signed certificate; reverify enterprise certificate support'],
  ['–  Pure extension gives visibility only, no placement intelligence', '–  Pure extension scope and compatibility must be verified for the selected WAC release'],
  ['Lab evaluation now. Re-assess at the 2027 planning cycle, gated on four things: GA, a documented HA design, CA certificate support, and a Pure Storage path.', 'Evaluate in a non-production environment. Gate approval on GA support, a documented availability design, enterprise certificate support, and required partner integrations.'],
  ['Anything going to production before mid-2027, and anything with a signed SLA behind it.', 'Any production or SLA-backed design while the required capabilities remain Preview or unsupported.'],
  ['The connector, control plane and resource bridge are all FREE', 'The Arc projection layer can enable Azure control; confirm current pricing for every enabled Azure service'],
  ['Real self-service through Azure RBAC — the best tenant portal of any plane', 'Azure portal and ARM lifecycle operations governed through Azure RBAC'],
  ['Azure services are metered per VM per month and accumulate quickly', 'Optional Azure services can add per-resource, consumption, and log-ingestion charges'],
  ["Microsoft's own 'choose an Arc service' guide omits Arc-SCVMM entirely — Azure Local is the favoured path", 'Product scope and roadmap differ across Arc-enabled SCVMM and Azure Local; validate the target platform explicitly'],
  ['As a per-tenant UPSELL on top of SCVMM, where the tenant already lives in Azure and wants one control plane across on-prem and cloud.', 'On top of SCVMM when Azure portal, ARM, or Azure RBAC management is a stated requirement and the organization accepts the dependency.'],
  ['Anywhere you need bare-metal provisioning, tenant clouds, Pure array integration, or V2V. This is the default answer for the core business.', 'Use it where bare-metal provisioning, tenant clouds, array integration, or policy-driven optimization are steady-state requirements. Treat V2V as a separate project workstream.'],
  ['Arc-enabled servers and SCVMM require live outbound connectivity; agents must check in and Update Manager only counts a machine as managed on days it is Connected.', 'Arc-enabled SCVMM requires an ongoing resource-bridge connection to Azure; enabled guest services have their own connectivity and billing-state requirements.'],
  ['Classic + WAC aMode is economically sensible. Continue to Q8.', 'Prefer Classic + WAC vMode if the production-readiness answer permits it; otherwise use aMode. Continue to Q8.'],
  ['Classic + WAC aMode. Do not licence System Center.', 'Prefer Classic + WAC aMode unless a hard fabric requirement justifies SCVMM; evaluate vMode only when Preview status and current gaps are acceptable.'],
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
const data = {
  generatedFrom: path.basename(source),
  decisionQuestionsVerified: String(decisionGuide.verified),
  decisionQuestionsBasis: String(decisionGuide.basis),
  decisionQuestions: decisionGuide.questions,
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
  platformLimits: sheetRows('Platform Limits').slice(4).filter((row) => row[0] && row[2]).map((row) => ({
    category: String(row[0]),
    scope: String(row[1]),
    capability: String(row[2]),
    value: String(row[3]),
    appliesTo: String(row[4]),
    basis: String(row[5]),
    verified: String(row[6]),
    source: String(row[7]),
    note: String(row[8]),
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

const banner = `// This file is generated from ${data.generatedFrom} and ${path.basename(decisionSource)}.\n// Run npm run generate:management after changing either source.\n\n`
const output = `${banner}export const MANAGEMENT_WORKBOOK = ${JSON.stringify(data, null, 2)} as const\n`
fs.writeFileSync(destination, output, 'utf8')

console.log(`Generated ${path.relative(root, destination)} from ${path.relative(root, source)}`)
console.log(`${data.featureMatrix.length} capabilities · ${data.vmwareTranslation.length} VMware translations · ${data.skuReference.length} SKUs · ${data.sources.length} sources`)
