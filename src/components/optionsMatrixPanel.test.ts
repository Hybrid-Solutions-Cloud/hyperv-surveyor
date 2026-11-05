import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SelectCell } from './OptionsMatrixPanel'
import type { MatrixOption } from '../engine/optionsMatrix'

const option = (rejected: boolean) => ({ rejected, rejectionReasons: rejected ? ['1 VM(s) cannot fit on a single host.'] : [] }) as unknown as MatrixOption
const cell = (rejected: boolean, selected: boolean) => renderToStaticMarkup(createElement('table', null, createElement('tbody', null, createElement('tr', null, createElement(SelectCell, { option: option(rejected), selected, onSelect: () => {} })))))

describe('Options matrix select cell', () => {
  it('shows why the option in use is ruled out instead of hiding it behind "Selected"', () => {
    const html = cell(true, true)
    expect(html).toContain('Selected, ruled out')
    expect(html).toContain('cannot fit on a single host')
  })
  it('keeps a plain Selected pill for a viable option in use, and the reason on other ruled-out rows', () => {
    expect(cell(false, true)).toContain('>Selected<')
    expect(cell(true, false)).toContain('cannot fit on a single host')
  })
})
