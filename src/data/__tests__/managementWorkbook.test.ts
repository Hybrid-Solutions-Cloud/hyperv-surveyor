import { describe, expect, it } from 'vitest'
import { CAPABILITIES, DECISION_QUESTIONS } from '../managementPlane'
import { MANAGEMENT_WORKBOOK } from '../managementWorkbook.generated'

describe('management workbook coverage', () => {
  it('retains every qualifying question and capability row', () => {
    expect(DECISION_QUESTIONS).toHaveLength(10)
    expect(CAPABILITIES).toHaveLength(85)
    expect(new Set(CAPABILITIES.map((row) => row.category)).size).toBe(10)
  })

  it('retains the supporting field and evidence libraries', () => {
    expect(MANAGEMENT_WORKBOOK.vmwareTranslation).toHaveLength(40)
    expect(MANAGEMENT_WORKBOOK.skuReference).toHaveLength(36)
    expect(MANAGEMENT_WORKBOOK.sources).toHaveLength(36)
    expect(MANAGEMENT_WORKBOOK.caveats).toHaveLength(9)
    expect(MANAGEMENT_WORKBOOK.advantages).toHaveLength(15)
    expect(MANAGEMENT_WORKBOOK.objections).toHaveLength(12)
  })

  it('preserves evidence and VMware context on every capability', () => {
    for (const row of CAPABILITIES) {
      expect(row.note).not.toBe('')
      expect(row.vmwareVsphere8).not.toBe('')
      expect(row.vmwareVcf9).not.toBe('')
    }
  })
})
