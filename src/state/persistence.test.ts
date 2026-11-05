import { describe, expect, it } from 'vitest'
import { createSurveyorStorage, fallbackMarker, type KeyValueDatabase } from './persistence'

function fakeLocal(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key) },
    setItem: (key, value) => { data.set(key, value) },
  }
}

function fakeDatabase(): KeyValueDatabase & { data: Map<string, string>; failWrites: boolean } {
  const data = new Map<string, string>()
  const db = {
    data,
    failWrites: false,
    get: async (name: string) => data.get(name),
    put: async (name: string, value: string) => { if (db.failWrites) throw new Error('quota'); data.set(name, value) },
    delete: async (name: string) => { data.delete(name) },
  }
  return db
}

describe('B17 saved-state storage', () => {
  it('reads a newer localStorage fallback instead of an older IndexedDB value', async () => {
    const local = fakeLocal()
    const db = fakeDatabase()
    const storage = createSurveyorStorage(db, () => local)
    await storage.setItem('state', 'v1')
    db.failWrites = true
    await storage.setItem('state', 'v2')
    expect(local.getItem(fallbackMarker('state'))).toBe('1')
    expect(await storage.getItem('state')).toBe('v2')
  })

  it('drops the fallback copy once IndexedDB saves again', async () => {
    const local = fakeLocal()
    const db = fakeDatabase()
    const storage = createSurveyorStorage(db, () => local)
    db.failWrites = true
    await storage.setItem('state', 'v1')
    db.failWrites = false
    await storage.setItem('state', 'v2')
    expect(local.getItem('state')).toBeNull()
    expect(await storage.getItem('state')).toBe('v2')
  })

  it('reads an old unmarked localStorage save only when IndexedDB has nothing', async () => {
    const local = fakeLocal()
    local.setItem('state', 'legacy')
    const db = fakeDatabase()
    const storage = createSurveyorStorage(db, () => local)
    expect(await storage.getItem('state')).toBe('legacy')
    db.data.set('state', 'current')
    expect(await storage.getItem('state')).toBe('current')
  })
})
