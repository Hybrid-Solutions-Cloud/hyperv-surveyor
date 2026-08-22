import type { StateStorage } from 'zustand/middleware'

const DATABASE = 'hyperv-surveyor'
const STORE = 'state'
const memory = new Map<string, string>()

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
    request.onsuccess = () => {
      const transaction = request.result.transaction(STORE, 'readwrite')
      const result = operation(transaction.objectStore(STORE))
      result.onsuccess = () => resolve(result.result)
      result.onerror = () => reject(result.error)
      transaction.oncomplete = () => request.result.close()
    }
  })
}

/** IndexedDB removes the localStorage size ceiling while keeping customer data on-device. */
export const surveyorStorage: StateStorage = {
  getItem(name) {
    if (typeof indexedDB !== 'undefined') return withDatabase((store) => store.get(name)).then((value) => value ?? browserStorage()?.getItem(name) ?? memory.get(name) ?? null).catch(() => browserStorage()?.getItem(name) ?? memory.get(name) ?? null)
    return browserStorage()?.getItem(name) ?? memory.get(name) ?? null
  },
  setItem(name, value) {
    if (typeof indexedDB !== 'undefined') return withDatabase((store) => store.put(value, name)).then(() => undefined).catch(() => { browserStorage()?.setItem(name, value) })
    const storage = browserStorage()
    if (storage) storage.setItem(name, value)
    else memory.set(name, value)
  },
  removeItem(name) {
    if (typeof indexedDB !== 'undefined') return withDatabase((store) => store.delete(name)).then(() => undefined).catch(() => { browserStorage()?.removeItem(name) })
    const storage = browserStorage()
    if (storage) storage.removeItem(name)
    else memory.delete(name)
  },
}
