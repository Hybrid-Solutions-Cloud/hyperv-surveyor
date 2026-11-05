import { describe, expect, it } from 'vitest'
import { spareHostsMax } from './ExistingHardwarePanel'
import { numberDraftProblem } from './numberDraft'

describe('Spare hosts field', () => {
  it('does not show the default spare host as an error before any host is entered', () => {
    expect(numberDraftProblem('1', 0, spareHostsMax(0, 1))).toBeNull()
  })
  it('still says what is valid once hosts are entered', () => {
    expect(spareHostsMax(4, 1)).toBe(4)
    expect(numberDraftProblem('5', 0, spareHostsMax(4, 1))).toBe('Enter a number from 0 to 4.')
  })
})
