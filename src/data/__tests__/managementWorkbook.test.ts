import { describe, expect, it } from 'vitest'
import { CAPABILITIES, DECISION_QUESTIONS } from '../managementPlane'
import { MANAGEMENT_WORKBOOK } from '../managementWorkbook.generated'

describe('management workbook coverage', () => {
  it('retains every qualifying question and capability row', () => {
    expect(DECISION_QUESTIONS).toHaveLength(18)
    expect(CAPABILITIES).toHaveLength(85)
    expect(new Set(CAPABILITIES.map((row) => row.category)).size).toBe(10)
  })

  it('keeps evidence links on every fact-backed qualifying question', () => {
    expect(MANAGEMENT_WORKBOOK.decisionQuestionsVerified).toBe('2026-08-22')
    for (const question of DECISION_QUESTIONS.filter((item) => item.sources.length > 0)) {
      for (const source of question.sources) expect(source.url).toMatch(/^https:\/\//)
    }
  })

  it('retains the supporting field and evidence libraries', () => {
    expect(MANAGEMENT_WORKBOOK.vmwareTranslation).toHaveLength(40)
    expect(MANAGEMENT_WORKBOOK.skuReference).toHaveLength(36)
    expect(MANAGEMENT_WORKBOOK.sources).toHaveLength(36)
    expect(MANAGEMENT_WORKBOOK.caveats).toHaveLength(9)
    expect(MANAGEMENT_WORKBOOK.advantages).toHaveLength(15)
    expect(MANAGEMENT_WORKBOOK.objections).toHaveLength(12)
    expect(MANAGEMENT_WORKBOOK.platformLimits).toHaveLength(29)
    expect(new Set(MANAGEMENT_WORKBOOK.platformLimits.map((row) => row.category)).size).toBe(7)
  })

  it('keeps a current source and verification date on every platform limit', () => {
    for (const row of MANAGEMENT_WORKBOOK.platformLimits) {
      expect(row.source).toMatch(/^https:\/\/learn\.microsoft\.com\//)
      expect(row.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('preserves evidence and VMware context on every capability', () => {
    for (const row of CAPABILITIES) {
      expect(row.note).not.toBe('')
      expect(row.vmwareVsphere8).not.toBe('')
      expect(row.vmwareVcf9).not.toBe('')
    }
  })
})
