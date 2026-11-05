import { describe, expect, it } from 'vitest'
import { profileLimitText } from './ExistingResultsPanel'

describe('More VMs card', () => {
  it('does not call zero room "not limited" when today\'s workload does not fit', () => {
    expect(profileLimitText({ count: 0, limitedBy: null })).toBe('no room until today\'s workload fits')
    expect(profileLimitText({ count: 12, limitedBy: null })).toBe('not limited')
    expect(profileLimitText({ count: 4, limitedBy: 'memory' })).toMatch(/^limited by /)
    expect(profileLimitText({ count: 0, limitedBy: 'host-size' })).toBe('the profile is larger than a host')
  })
})
