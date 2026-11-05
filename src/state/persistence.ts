import type { StateStorage } from 'zustand/middleware'

const DATABASE = 'hyperv-surveyor'
const STORE = 'state'

/** The parts of IndexedDB this module uses, so tests can supply a fake. */
export interface KeyValueDatabase {
  get(name: string): Promise<string | null | undefined>
  put(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
}

/** localStorage holds a value under this marker only when IndexedDB failed to save the newer one. */
export const fallbackMarker = (name: string) => `${name}::fallback`

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function withDatabase<T>(operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab.'))
    request.onsuccess = () => {
      try {
        const transaction = request.result.transaction(STORE, 'readwrite')
        const result = operation(transaction.objectStore(STORE))
        result.onsuccess = () => resolve(result.result)
        result.onerror = () => reject(result.error)
        transaction.oncomplete = () => request.result.close()
      } catch (error) {
        request.result.close()
        reject(error)
      }
    }
  })
}

const indexedDatabase: KeyValueDatabase = {
  get: (name) => withDatabase((store) => store.get(name) as IDBRequest<string | undefined>),
  put: (name, value) => withDatabase((store) => store.put(value, name)).then(() => undefined),
  delete: (name) => withDatabase((store) => store.delete(name)).then(() => undefined),
}

/**
 * IndexedDB removes the localStorage size ceiling while keeping customer data on-device.
 *
 * When an IndexedDB write fails the value goes to localStorage with a marker, and reads prefer a
 * marked localStorage value because it is newer than whatever IndexedDB still holds. A later
 * successful IndexedDB write removes the fallback copy. Unmarked localStorage values, such as
 * saves from versions before IndexedDB, are read only when IndexedDB has nothing.
 */
export function createSurveyorStorage(database: KeyValueDatabase | null, local: () => Storage | null, memory = new Map<string, string>()): StateStorage {
  const writeFallback = (name: string, value: string) => {
    const storage = local()
    try {
      if (!storage) throw new Error('No localStorage')
      storage.setItem(name, value)
      storage.setItem(fallbackMarker(name), '1')
    } catch {
      memory.set(name, value)
    }
  }
  const clearFallback = (name: string) => {
    const storage = local()
    if (storage?.getItem(fallbackMarker(name))) {
      storage.removeItem(name)
      storage.removeItem(fallbackMarker(name))
    }
    memory.delete(name)
  }
  const localValue = (name: string) => local()?.getItem(name) ?? null
  return {
    getItem(name) {
      if (memory.has(name)) return memory.get(name)!
      if (!database) return localValue(name)
      if (local()?.getItem(fallbackMarker(name))) return localValue(name)
      return database.get(name).then((value) => value ?? localValue(name)).catch(() => localValue(name))
    },
    setItem(name, value) {
      if (!database) {
        const storage = local()
        if (storage) storage.setItem(name, value)
        else memory.set(name, value)
        return
      }
      return database.put(name, value).then(() => clearFallback(name)).catch(() => writeFallback(name, value))
    },
    removeItem(name) {
      memory.delete(name)
      const storage = local()
      storage?.removeItem(fallbackMarker(name))
      if (!database) {
        storage?.removeItem(name)
        return
      }
      return database.delete(name).then(() => { storage?.removeItem(name) }).catch(() => { storage?.removeItem(name) })
    },
  }
}

export const surveyorStorage: StateStorage = createSurveyorStorage(typeof indexedDB !== 'undefined' ? indexedDatabase : null, browserStorage)
