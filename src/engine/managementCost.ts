import { PRICE_BOOK, type PlaneId } from '../data/managementPlane'

export type LicenseModel = 'perpetual' | 'spla'

export interface ManagementCostInputs {
  hosts: number
  sockets: number
  coresPerSocket: number
  vms: number
  spareHosts: number
  termYears: number
  sqlCores: number
  azurePerVmMonth: number
  model: LicenseModel
}

export interface ManagementPlaneCost {
  total: number
  managementOnly: number
  perVmMonth: number
}

export function calculatePlaneCost(plane: PlaneId, inputs: ManagementCostInputs): ManagementPlaneCost {
  const coresPerHost = Math.max(inputs.sockets * inputs.coresPerSocket, inputs.sockets * 8, 16)
  const packsPerHost = Math.ceil(coresPerHost / 2)
  const months = Math.max(1, inputs.termYears * 12)
  const needsSystemCenter = plane === 'scvmm' || plane === 'arc-scvmm'

  const windowsBase = inputs.model === 'perpetual'
    ? inputs.hosts * packsPerHost * PRICE_BOOK.windowsPerTwoCorePack
    : inputs.hosts * packsPerHost * PRICE_BOOK.windowsSplaPerTwoCorePackMonth * months
  const windows = inputs.model === 'perpetual'
    ? windowsBase * (1 + PRICE_BOOK.softwareAssuranceAnnualRate * Math.max(inputs.termYears - 1, 0))
    : windowsBase

  const systemCenterBase = !needsSystemCenter
    ? 0
    : inputs.model === 'perpetual'
      ? inputs.hosts * packsPerHost * PRICE_BOOK.systemCenterPerTwoCorePack
      : inputs.hosts * packsPerHost * PRICE_BOOK.systemCenterSplaPerTwoCorePackMonth * months
  const systemCenter = inputs.model === 'perpetual'
    ? systemCenterBase * (1 + PRICE_BOOK.softwareAssuranceAnnualRate * Math.max(inputs.termYears - 1, 0))
    : systemCenterBase
  const sqlBase = needsSystemCenter ? inputs.sqlCores * PRICE_BOOK.sqlStandardPerCore : 0
  // The reference perpetual model applies the same annual assurance assumption to
  // the complete licensed software subtotal, including SQL Server.
  const sql = inputs.model === 'perpetual'
    ? sqlBase * (1 + PRICE_BOOK.softwareAssuranceAnnualRate * Math.max(inputs.termYears - 1, 0))
    : sqlBase
  const azure = plane === 'arc-scvmm' ? inputs.vms * inputs.azurePerVmMonth * months : 0
  const managementOnly = systemCenter + sql + azure
  const total = windows + managementOnly
  const effectiveVms = Math.max(1, inputs.vms)

  return { total, managementOnly, perVmMonth: total / effectiveVms / months }
}
