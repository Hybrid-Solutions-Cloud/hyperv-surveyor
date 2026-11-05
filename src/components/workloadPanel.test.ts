import { describe, expect, it } from 'vitest'
import { rowsShownText } from './WorkloadPanel'

describe('Inventory rows line', () => {
  it('says every row can be scrolled only when they are all on the page', () => {
    expect(rowsShownText(1, 1000, 1000, 2000)).toBe('Showing rows 1–1,000 of 1,000 matching VMs, out of 2,000 in the inventory. Scroll the list to see them all.')
  })
  it('points to the pager when the list is split into pages', () => {
    const text = rowsShownText(1, 200, 2000, 2000)
    expect(text).toMatch(/^Showing rows 1–200 of 2,000 VMs\. /)
    expect(text).not.toMatch(/Scroll the list to see them all/)
    expect(text).toMatch(/Previous and Next/)
  })
})
