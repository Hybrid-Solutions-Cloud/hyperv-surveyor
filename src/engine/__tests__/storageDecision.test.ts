import { describe, expect, it } from 'vitest'
import { assessStorageDecision } from '../storageDecision'
import { compareArchitectures } from '../solve'
import { makeConfig, makeTiers, vm } from './fixtures'

describe('storage decision guide', () => {
  it('gives no direction until a question is answered', () => {
    const guide = assessStorageDecision({})
    expect(guide.answered).toBe(0)
    expect(guide.leaning).toBeNull()
  })

  it('leans SAN for an existing array and storage team', () => {
    expect(assessStorageDecision({ existingArray: true, storageTeam: true, arrayFeatures: true }).leaning).toBe('san')
  })

  it('leans S2D for a single platform with no array or storage team', () => {
    expect(assessStorageDecision({ existingArray: false, storageTeam: false, singlePlatform: true }).leaning).toBe('s2d')
  })

  it('leans hybrid only when workloads need both', () => {
    expect(assessStorageDecision({ mixedWorkloads: true, datacenter: true }).leaning).toBe('hybrid')
    expect(assessStorageDecision({ mixedWorkloads: false, existingArray: true }).leaning).toBe('san')
  })

  it('rules out S2D and hybrid without Datacenter edition', () => {
    const guide = assessStorageDecision({ datacenter: false, singlePlatform: true })
    expect(guide.excluded).toEqual(expect.arrayContaining(['s2d', 'hybrid']))
    expect(guide.leaning).toBe('san')
  })

  it('reports a tie rather than inventing a winner', () => {
    const guide = assessStorageDecision({ datacenter: true })
    expect(guide.leaning).toBeNull()
    expect(guide.headline).toContain('do not separate')
  })

  it('adds evidence from the sizing results', () => {
    const options = compareArchitectures(makeConfig({ sanSizingMode: 'calculated' }), [vm()], makeTiers())
    const guide = assessStorageDecision({}, options)
    expect(guide.evidence.some((item) => item.includes('SAN needs'))).toBe(true)
    expect(guide.evidence.some((item) => item.includes('usable array capacity'))).toBe(true)
  })
})
