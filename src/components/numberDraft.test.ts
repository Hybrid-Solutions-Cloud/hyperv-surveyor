import { describe, expect, it } from 'vitest'
import { formatNumberDraft, numberDraftProblem, parseNumberDraft } from './numberDraft'

describe('number fields', () => {
  it('does not turn an empty field into 0', () => {
    expect(parseNumberDraft('', 1)).toBeNull()
    expect(parseNumberDraft('   ')).toBeNull()
  })

  it('accepts 0 only where 0 is allowed', () => {
    expect(parseNumberDraft('0', 0)).toBe(0)
    expect(parseNumberDraft('0', 1)).toBeNull()
  })

  it('does not commit a value out of range', () => {
    expect(parseNumberDraft('1', 16)).toBeNull()
    expect(parseNumberDraft('16', 16)).toBe(16)
    expect(parseNumberDraft('95', 0, 90)).toBeNull()
  })

  it('tells the user what is valid', () => {
    expect(numberDraftProblem('', 1, 8)).toBe('Enter a number from 1 to 8.')
    expect(numberDraftProblem('', 1)).toBe('Enter 1 or more.')
    expect(numberDraftProblem('', undefined, 8)).toBe('Enter 8 or less.')
    expect(numberDraftProblem('')).toBe('Enter a number.')
    expect(numberDraftProblem('4', 1, 8)).toBeNull()
  })

  it('shows percentages without floating-point noise', () => {
    expect(formatNumberDraft(0.07 * 100)).toBe('7')
    expect(formatNumberDraft(Number.NaN)).toBe('0')
  })
})
