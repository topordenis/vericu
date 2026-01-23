// File System Access API utilities with IndexedDB persistence

const DB_NAME = 'webols-files'
const DB_VERSION = 1
const STORE_NAME = 'fileHandles'

// Open IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
  })
}

// Store a file handle
export async function storeFileHandle(key, handle) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(handle, key)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

// Get a stored file handle
export async function getFileHandle(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(key)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

// Remove a stored file handle
export async function removeFileHandle(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.delete(key)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

// Check if File System Access API is supported
export function isFileSystemAccessSupported() {
  return 'showOpenFilePicker' in window
}

// Open a file using File System Access API
export async function openFile() {
  if (!isFileSystemAccessSupported()) {
    throw new Error('File System Access API not supported')
  }

  // Use excludeAcceptAllOption: false to allow all files
  const [handle] = await window.showOpenFilePicker({
    excludeAcceptAllOption: false,
    multiple: false,
  })

  const file = await handle.getFile()
  const arrayBuffer = await file.arrayBuffer()

  return {
    handle,
    name: file.name,
    data: new Uint8Array(arrayBuffer),
  }
}

// Read file from a stored handle (requires permission)
export async function readFromHandle(handle) {
  // Request permission if needed
  const permission = await handle.queryPermission({ mode: 'read' })
  if (permission !== 'granted') {
    const requested = await handle.requestPermission({ mode: 'read' })
    if (requested !== 'granted') {
      throw new Error('Permission denied')
    }
  }

  const file = await handle.getFile()
  const arrayBuffer = await file.arrayBuffer()

  return {
    name: file.name,
    data: new Uint8Array(arrayBuffer),
  }
}

// Try to restore files from stored handles
export async function tryRestoreFile(key) {
  try {
    const handle = await getFileHandle(key)
    if (!handle) return null

    // Check if we still have permission
    const permission = await handle.queryPermission({ mode: 'read' })

    return {
      handle,
      hasPermission: permission === 'granted',
      name: handle.name,
    }
  } catch (e) {
    console.error('Failed to restore file handle:', e)
    return null
  }
}
