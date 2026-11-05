import { describe, expect, it } from 'vitest'
import { offPathNotice } from './NewPlatformStep'

describe('Notice on a new-platform page opened from another path', () => {
  it('tells a management-only user that the server and spare nodes still size a dedicated management cluster', () => {
    expect(offPathNotice('management-only', '/configuration')).toMatch(/the server and host reserves size a dedicated management cluster/)
    expect(offPathNotice('management-only', '/goals')).toMatch(/the spare nodes size a dedicated management cluster/)
    expect(offPathNotice('management-only', '/configuration')).not.toMatch(/not this page/)
  })
  it('keeps the plain notice elsewhere', () => {
    expect(offPathNotice('management-only', '/results')).toMatch(/use that path, not this page/)
    expect(offPathNotice('fit-gap', '/configuration')).toMatch(/use that path, not this page/)
  })
})
