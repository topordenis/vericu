import { useCallback, useEffect, useRef, useState } from 'react'
import HexViewer from './HexViewer'
import TableModal from './TableModal'
import TableList from './TableList'
import TableViewer from './TableViewer'
import DiffList from './DiffList'
import SearchPanel from './SearchPanel'
import MapFinder from './MapFinder'
import RevLimitFinder from './RevLimitFinder'
import ChecksumCalculator from './ChecksumCalculator'
import MapSensorFinder from './MapSensorFinder'
import {
  isFileSystemAccessSupported,
  openFile,
  storeFileHandle,
  tryRestoreFile,
  readFromHandle,
  removeFileHandle,
} from './fileSystem'

const STORAGE_KEY = 'webols-project'
const TYPE_SIZES_MAP = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4 }

function ExportDropdown({ fileDataA, fileDataB, fileDataC, fileNameA, fileNameB, fileNameC, onDownload }) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-1 rounded text-sm bg-green-700 hover:bg-green-600 text-white transition-colors flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Export
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 py-1 min-w-[140px]">
          {fileDataA && (
            <button
              onClick={() => {
                onDownload(fileDataA, fileNameA)
                setIsOpen(false)
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-blue-300 hover:bg-gray-700 flex items-center gap-2"
            >
              <span className="w-4 h-4 rounded bg-blue-600 text-xs flex items-center justify-center text-white">A</span>
              {fileNameA || 'File A'}
            </button>
          )}
          {fileDataB && (
            <button
              onClick={() => {
                onDownload(fileDataB, fileNameB)
                setIsOpen(false)
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-green-300 hover:bg-gray-700 flex items-center gap-2"
            >
              <span className="w-4 h-4 rounded bg-green-600 text-xs flex items-center justify-center text-white">B</span>
              {fileNameB || 'File B'}
            </button>
          )}
          {fileDataC && (
            <button
              onClick={() => {
                onDownload(fileDataC, fileNameC)
                setIsOpen(false)
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-orange-300 hover:bg-gray-700 flex items-center gap-2"
            >
              <span className="w-4 h-4 rounded bg-orange-600 text-xs flex items-center justify-center text-white">C</span>
              {fileNameC || 'File C'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function App() {
  const fileInputRefA = useRef(null)
  const fileInputRefB = useRef(null)
  const fileInputRefC = useRef(null)
  const projectInputRef = useRef(null)
  const hexViewerRef = useRef(null)
  const initialized = useRef(false)

  // Project metadata
  const [projectName, setProjectName] = useState('Untitled Project')

  // Dual file support
  const [fileNameA, setFileNameA] = useState(null)
  const [fileDataA, setFileDataA] = useState(null)
  const [fileHandleA, setFileHandleA] = useState(null)
  const [needsPermissionA, setNeedsPermissionA] = useState(false)

  const [fileNameB, setFileNameB] = useState(null)
  const [fileDataB, setFileDataB] = useState(null)
  const [fileHandleB, setFileHandleB] = useState(null)
  const [needsPermissionB, setNeedsPermissionB] = useState(false)

  const [fileNameC, setFileNameC] = useState(null)
  const [fileDataC, setFileDataC] = useState(null)
  const [fileHandleC, setFileHandleC] = useState(null)
  const [needsPermissionC, setNeedsPermissionC] = useState(false)

  const [compareMode, setCompareMode] = useState('A') // 'A', 'B', 'C', or 'diff:X-Y'
  const [diffPair, setDiffPair] = useState('A-B') // Which files to diff: 'A-B', 'A-C', 'B-C'

  const [viewMode, setViewMode] = useState('hex')
  const [endianness, setEndianness] = useState('little') // 'little' or 'big'
  const [heatmapEnabled, setHeatmapEnabled] = useState(false)
  const [formula, setFormula] = useState('') // e.g., "x * 0.375 - 23.625"
  const [showFormulaInput, setShowFormulaInput] = useState(false)

  // Table system state
  const [tables, setTables] = useState([])
  const [showTableModal, setShowTableModal] = useState(false)
  const [editingTable, setEditingTable] = useState(null)
  const [selectedTableId, setSelectedTableId] = useState(null)
  const [viewingTable, setViewingTable] = useState(null)
  const [clipboard, setClipboard] = useState(null) // { tableId, sourceFile, selection, bytes }
  const [sidebarTab, setSidebarTab] = useState('tables') // 'tables', 'diffs', 'search', 'finder', 'rev'

  const viewModes = ['hex', 'u8', 'i8', 'u16', 'i16', 'u32', 'i32']

  // Check if we have data to show
  const hasAnyFile = fileDataA || fileDataB || fileDataC
  const loadedFilesCount = [fileDataA, fileDataB, fileDataC].filter(Boolean).length

  // Check if File System Access API is available
  const fsApiSupported = isFileSystemAccessSupported()

  // Load project from localStorage on mount and try to restore file handles
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const loadProject = async () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
          const project = JSON.parse(saved)
          if (project.projectName) setProjectName(project.projectName)
          if (project.tables) setTables(project.tables)
          if (project.viewMode) setViewMode(project.viewMode)
          if (project.compareMode) setCompareMode(project.compareMode)
          if (project.diffPair) setDiffPair(project.diffPair)
          if (project.endianness) setEndianness(project.endianness)
          if (project.fileNameA) setFileNameA(project.fileNameA)
          if (project.fileNameB) setFileNameB(project.fileNameB)
          if (project.fileNameC) setFileNameC(project.fileNameC)
        }

        // Try to restore file handles from IndexedDB
        if (fsApiSupported) {
          const restoredA = await tryRestoreFile('fileA')
          if (restoredA) {
            setFileHandleA(restoredA.handle)
            setFileNameA(restoredA.name)
            if (restoredA.hasPermission) {
              // Auto-load if we already have permission
              try {
                const result = await readFromHandle(restoredA.handle)
                setFileDataA(result.data)
              } catch (e) {
                setNeedsPermissionA(true)
              }
            } else {
              setNeedsPermissionA(true)
            }
          }

          const restoredB = await tryRestoreFile('fileB')
          if (restoredB) {
            setFileHandleB(restoredB.handle)
            setFileNameB(restoredB.name)
            if (restoredB.hasPermission) {
              try {
                const result = await readFromHandle(restoredB.handle)
                setFileDataB(result.data)
              } catch (e) {
                setNeedsPermissionB(true)
              }
            } else {
              setNeedsPermissionB(true)
            }
          }

          const restoredC = await tryRestoreFile('fileC')
          if (restoredC) {
            setFileHandleC(restoredC.handle)
            setFileNameC(restoredC.name)
            if (restoredC.hasPermission) {
              try {
                const result = await readFromHandle(restoredC.handle)
                setFileDataC(result.data)
              } catch (e) {
                setNeedsPermissionC(true)
              }
            } else {
              setNeedsPermissionC(true)
            }
          }
        }
      } catch (e) {
        console.error('Failed to load project:', e)
      }
    }

    loadProject()
  }, [fsApiSupported])

  // Save project to localStorage when relevant state changes
  useEffect(() => {
    if (!initialized.current) return

    const project = {
      projectName,
      tables,
      viewMode,
      compareMode,
      diffPair,
      endianness,
      fileNameA,
      fileNameB,
      fileNameC,
      savedAt: new Date().toISOString(),
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
    } catch (e) {
      console.error('Failed to save project:', e)
    }
  }, [projectName, tables, viewMode, compareMode, diffPair, endianness, fileNameA, fileNameB, fileNameC])

  // Export project as JSON file
  const handleExportProject = useCallback(() => {
    const project = {
      projectName,
      tables,
      viewMode,
      compareMode,
      diffPair,
      endianness,
      fileNameA,
      fileNameB,
      fileNameC,
      exportedAt: new Date().toISOString(),
      version: 1,
    }

    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.webols.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [projectName, tables, viewMode, compareMode, diffPair, endianness, fileNameA, fileNameB, fileNameC])

  // Import project from JSON file
  const handleImportProject = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const project = JSON.parse(event.target.result)
        if (project.projectName) setProjectName(project.projectName)
        if (project.tables) setTables(project.tables)
        if (project.viewMode) setViewMode(project.viewMode)
        if (project.compareMode) setCompareMode(project.compareMode)
        if (project.diffPair) setDiffPair(project.diffPair)
        if (project.endianness) setEndianness(project.endianness)
        if (project.fileNameA) setFileNameA(project.fileNameA)
        if (project.fileNameB) setFileNameB(project.fileNameB)
        if (project.fileNameC) setFileNameC(project.fileNameC)

        // Clear file data since we can't store actual binary data
        setFileDataA(null)
        setFileDataB(null)
        setFileDataC(null)
        setViewingTable(null)
        setSelectedTableId(null)
      } catch (err) {
        alert('Failed to import project: Invalid JSON file')
      }
    }
    reader.readAsText(file)
    e.target.value = '' // Reset input
  }, [])

  // Clear project
  const handleNewProject = useCallback(async () => {
    if (tables.length > 0 && !confirm('Create new project? Current tables will be lost.')) {
      return
    }
    setProjectName('Untitled Project')
    setTables([])
    setFileNameA(null)
    setFileNameB(null)
    setFileNameC(null)
    setFileDataA(null)
    setFileDataB(null)
    setFileDataC(null)
    setFileHandleA(null)
    setFileHandleB(null)
    setFileHandleC(null)
    setNeedsPermissionA(false)
    setNeedsPermissionB(false)
    setNeedsPermissionC(false)
    setViewingTable(null)
    setSelectedTableId(null)
    setViewMode('hex')
    setCompareMode('A')
    setDiffPair('A-B')
    localStorage.removeItem(STORAGE_KEY)

    // Clear stored file handles
    if (fsApiSupported) {
      await removeFileHandle('fileA')
      await removeFileHandle('fileB')
      await removeFileHandle('fileC')
    }
  }, [tables.length, fsApiSupported])

  const handleSaveTable = (table) => {
    setTables((prev) => {
      const existing = prev.findIndex((t) => t.id === table.id)
      if (existing >= 0) {
        const updated = [...prev]
        updated[existing] = table
        return updated
      }
      return [...prev, table]
    })
    // Update viewing table if it was edited
    if (viewingTable?.id === table.id) {
      setViewingTable(table)
    }
    setEditingTable(null)
  }

  const handleEditTable = (table) => {
    setEditingTable(table)
    setShowTableModal(true)
  }

  const handleDeleteTable = (id) => {
    setTables((prev) => prev.filter((t) => t.id !== id))
    if (selectedTableId === id) {
      setSelectedTableId(null)
      setViewingTable(null)
    }
  }

  const handleSelectTable = (table) => {
    setSelectedTableId(table.id)
    setViewingTable(table)
  }

  const handleCopyWholeTable = useCallback((table) => {
    const fileMap = { A: fileDataA, B: fileDataB, C: fileDataC }
    const sourceKey = compareMode === 'diff' ? 'A' : compareMode
    const sourceData = fileMap[sourceKey]
    if (!sourceData) return

    const size = TYPE_SIZES_MAP[table.dataType]
    const totalBytes = table.rows * table.cols * size
    const bytes = new Uint8Array(totalBytes)

    for (let i = 0; i < totalBytes; i++) {
      bytes[i] = sourceData[table.offset + i] ?? 0
    }

    setClipboard({
      tableId: table.id,
      sourceFile: sourceKey,
      selection: { startRow: 0, startCol: 0, endRow: table.rows - 1, endCol: table.cols - 1 },
      bytes,
    })
  }, [fileDataA, fileDataB, fileDataC, compareMode])

  const handleOpenFileA = async () => {
    if (fsApiSupported) {
      try {
        const result = await openFile()
        setFileNameA(result.name)
        setFileDataA(result.data)
        setFileHandleA(result.handle)
        setNeedsPermissionA(false)
        await storeFileHandle('fileA', result.handle)
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('Failed to open file:', e)
        }
      }
    } else {
      fileInputRefA.current?.click()
    }
  }

  const handleOpenFileB = async () => {
    if (fsApiSupported) {
      try {
        const result = await openFile()
        setFileNameB(result.name)
        setFileDataB(result.data)
        setFileHandleB(result.handle)
        setNeedsPermissionB(false)
        await storeFileHandle('fileB', result.handle)
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('Failed to open file:', e)
        }
      }
    } else {
      fileInputRefB.current?.click()
    }
  }

  const handleOpenFileC = async () => {
    if (fsApiSupported) {
      try {
        const result = await openFile()
        setFileNameC(result.name)
        setFileDataC(result.data)
        setFileHandleC(result.handle)
        setNeedsPermissionC(false)
        await storeFileHandle('fileC', result.handle)
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('Failed to open file:', e)
        }
      }
    } else {
      fileInputRefC.current?.click()
    }
  }

  // Request permission for stored file handle
  const handleRequestPermissionA = async () => {
    if (!fileHandleA) return
    try {
      const result = await readFromHandle(fileHandleA)
      setFileDataA(result.data)
      setNeedsPermissionA(false)
    } catch (e) {
      console.error('Permission denied or file not accessible:', e)
    }
  }

  const handleRequestPermissionB = async () => {
    if (!fileHandleB) return
    try {
      const result = await readFromHandle(fileHandleB)
      setFileDataB(result.data)
      setNeedsPermissionB(false)
    } catch (e) {
      console.error('Permission denied or file not accessible:', e)
    }
  }

  const handleRequestPermissionC = async () => {
    if (!fileHandleC) return
    try {
      const result = await readFromHandle(fileHandleC)
      setFileDataC(result.data)
      setNeedsPermissionC(false)
    } catch (e) {
      console.error('Permission denied or file not accessible:', e)
    }
  }

  // Fallback file input handlers for browsers without File System Access API
  const handleFileChangeA = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileNameA(file.name)
    const reader = new FileReader()
    reader.onload = (event) => {
      const arrayBuffer = event.target.result
      setFileDataA(new Uint8Array(arrayBuffer))
    }
    reader.readAsArrayBuffer(file)
  }

  const handleFileChangeB = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileNameB(file.name)
    const reader = new FileReader()
    reader.onload = (event) => {
      const arrayBuffer = event.target.result
      setFileDataB(new Uint8Array(arrayBuffer))
    }
    reader.readAsArrayBuffer(file)
  }

  const handleFileChangeC = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileNameC(file.name)
    const reader = new FileReader()
    reader.onload = (event) => {
      const arrayBuffer = event.target.result
      setFileDataC(new Uint8Array(arrayBuffer))
    }
    reader.readAsArrayBuffer(file)
  }

  // Download/export file
  const handleDownloadFile = (data, fileName) => {
    if (!data) return
    const blob = new Blob([data], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // Add _modified suffix before extension
    const dotIndex = fileName?.lastIndexOf('.') ?? -1
    const newName = dotIndex > 0
      ? fileName.slice(0, dotIndex) + '_modified' + fileName.slice(dotIndex)
      : (fileName || 'file') + '_modified.bin'
    a.download = newName
    a.click()
    URL.revokeObjectURL(url)
  }

  // Get files for diff based on diffPair
  const getDiffFiles = () => {
    const files = { A: fileDataA, B: fileDataB, C: fileDataC }
    const [first, second] = diffPair.split('-')
    return { dataA: files[first], dataB: files[second] }
  }

  return (
    <div className="h-screen bg-gray-900 flex flex-col overflow-hidden">
      {/* Top Bar Menu */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center gap-4 shrink-0">
        {/* Project name - editable */}
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          className="bg-transparent text-gray-300 font-semibold border-b border-transparent hover:border-gray-600 focus:border-blue-500 outline-none px-1 max-w-[200px]"
          title="Click to edit project name"
        />

        {/* Project controls */}
        <div className="flex gap-1">
          <button
            onClick={handleNewProject}
            className="text-gray-400 hover:text-gray-200 hover:bg-gray-700 p-1.5 rounded transition-colors"
            title="New Project"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={() => projectInputRef.current?.click()}
            className="text-gray-400 hover:text-gray-200 hover:bg-gray-700 p-1.5 rounded transition-colors"
            title="Import Project"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </button>
          <button
            onClick={handleExportProject}
            className="text-gray-400 hover:text-gray-200 hover:bg-gray-700 p-1.5 rounded transition-colors"
            title="Export Project"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        </div>

        <div className="h-4 w-px bg-gray-600" />

        {/* File A button */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleOpenFileA}
            className={`px-3 py-1 rounded text-sm transition-colors ${
              fileDataA
                ? 'bg-blue-900/50 text-blue-300 hover:bg-blue-800/50'
                : needsPermissionA
                  ? 'bg-yellow-900/50 text-yellow-300 hover:bg-yellow-800/50'
                  : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            {fileNameA ? `A: ${fileNameA}` : 'Open File A'}
          </button>
          {needsPermissionA && (
            <button
              onClick={handleRequestPermissionA}
              className="px-2 py-1 rounded text-xs bg-yellow-600 hover:bg-yellow-500 text-white transition-colors"
              title="Click to grant file access permission"
            >
              Grant Access
            </button>
          )}
        </div>

        {/* File B button */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleOpenFileB}
            className={`px-3 py-1 rounded text-sm transition-colors ${
              fileDataB
                ? 'bg-green-900/50 text-green-300 hover:bg-green-800/50'
                : needsPermissionB
                  ? 'bg-yellow-900/50 text-yellow-300 hover:bg-yellow-800/50'
                  : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            {fileNameB ? `B: ${fileNameB}` : 'Open File B'}
          </button>
          {needsPermissionB && (
            <button
              onClick={handleRequestPermissionB}
              className="px-2 py-1 rounded text-xs bg-yellow-600 hover:bg-yellow-500 text-white transition-colors"
              title="Click to grant file access permission"
            >
              Grant Access
            </button>
          )}
        </div>

        {/* File C button */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleOpenFileC}
            className={`px-3 py-1 rounded text-sm transition-colors ${
              fileDataC
                ? 'bg-orange-900/50 text-orange-300 hover:bg-orange-800/50'
                : needsPermissionC
                  ? 'bg-yellow-900/50 text-yellow-300 hover:bg-yellow-800/50'
                  : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            {fileNameC ? `C: ${fileNameC}` : 'Open File C'}
          </button>
          {needsPermissionC && (
            <button
              onClick={handleRequestPermissionC}
              className="px-2 py-1 rounded text-xs bg-yellow-600 hover:bg-yellow-500 text-white transition-colors"
              title="Click to grant file access permission"
            >
              Grant Access
            </button>
          )}
        </div>

        {/* Export dropdown */}
        {hasAnyFile && (
          <ExportDropdown
            fileDataA={fileDataA}
            fileDataB={fileDataB}
            fileDataC={fileDataC}
            fileNameA={fileNameA}
            fileNameB={fileNameB}
            fileNameC={fileNameC}
            onDownload={handleDownloadFile}
          />
        )}

        {/* Compare mode toggle (when at least 2 files loaded) */}
        {loadedFilesCount >= 2 && !viewingTable && (
          <>
            <div className="h-4 w-px bg-gray-600" />
            <div className="flex gap-1">
              {fileDataA && (
                <button
                  onClick={() => setCompareMode('A')}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    compareMode === 'A'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  A
                </button>
              )}
              {fileDataB && (
                <button
                  onClick={() => setCompareMode('B')}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    compareMode === 'B'
                      ? 'bg-green-600 text-white'
                      : 'text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  B
                </button>
              )}
              {fileDataC && (
                <button
                  onClick={() => setCompareMode('C')}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    compareMode === 'C'
                      ? 'bg-orange-600 text-white'
                      : 'text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  C
                </button>
              )}
              <div className="w-px bg-gray-600 mx-1" />
              <button
                onClick={() => setCompareMode('diff')}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  compareMode === 'diff'
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:bg-gray-700'
                }`}
              >
                Diff
              </button>
              {compareMode === 'diff' && (
                <select
                  value={diffPair}
                  onChange={(e) => setDiffPair(e.target.value)}
                  className="bg-gray-700 text-gray-300 text-xs rounded px-1 py-1 outline-none"
                >
                  {fileDataA && fileDataB && <option value="A-B">A↔B</option>}
                  {fileDataA && fileDataC && <option value="A-C">A↔C</option>}
                  {fileDataB && fileDataC && <option value="B-C">B↔C</option>}
                </select>
              )}
            </div>
          </>
        )}

        {hasAnyFile && (
          <>
            <div className="h-4 w-px bg-gray-600" />
            <button
              onClick={() => hexViewerRef.current?.openGoToDialog()}
              className="text-gray-300 hover:bg-gray-700 px-3 py-1 rounded text-sm transition-colors"
            >
              Go to
            </button>
            <div className="h-4 w-px bg-gray-600" />
            <div className="flex gap-1">
              {viewModes.map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                    viewMode === mode
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setEndianness('little')}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  endianness === 'little' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                }`}
                title="Little Endian"
              >
                LE
              </button>
              <button
                onClick={() => setEndianness('big')}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  endianness === 'big' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                }`}
                title="Big Endian"
              >
                BE
              </button>
            </div>
            <button
              onClick={() => setHeatmapEnabled(!heatmapEnabled)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                heatmapEnabled ? 'bg-gradient-to-r from-blue-500 via-green-500 to-red-500 text-white' : 'text-gray-400 hover:bg-gray-700'
              }`}
              title="Toggle heatmap coloring"
            >
              Heat
            </button>
            <div className="relative">
              <button
                onClick={() => setShowFormulaInput(!showFormulaInput)}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  formula ? 'bg-purple-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                }`}
                title="Value formula (e.g., x * 0.375 - 23.625)"
              >
                f(x)
              </button>
              {showFormulaInput && (
                <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg p-2 shadow-xl z-50 w-64">
                  <div className="text-xs text-gray-400 mb-1">Formula (use x for value)</div>
                  <input
                    type="text"
                    value={formula}
                    onChange={(e) => setFormula(e.target.value)}
                    placeholder="x * 0.375 - 23.625"
                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 font-mono outline-none focus:border-blue-500"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        setShowFormulaInput(false)
                      }
                    }}
                  />
                  <div className="flex justify-between mt-2">
                    <button
                      onClick={() => setFormula('')}
                      className="text-xs text-gray-500 hover:text-gray-300"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => setShowFormulaInput(false)}
                      className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-0.5 rounded"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="h-4 w-px bg-gray-600" />
            <button
              onClick={() => {
                setEditingTable(null)
                setShowTableModal(true)
              }}
              className="text-gray-300 hover:bg-gray-700 px-3 py-1 rounded text-sm transition-colors"
            >
              New Table
            </button>
          </>
        )}

        {/* Status info */}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <span className="text-gray-600 text-xs flex items-center gap-1" title="Project auto-saved to browser storage">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Saved
          </span>
        </div>
      </div>

      {/* Hidden file inputs */}
      <input
        type="file"
        ref={fileInputRefA}
        onChange={handleFileChangeA}
        className="hidden"
      />
      <input
        type="file"
        ref={fileInputRefB}
        onChange={handleFileChangeB}
        className="hidden"
      />
      <input
        type="file"
        ref={fileInputRefC}
        onChange={handleFileChangeC}
        className="hidden"
      />
      <input
        type="file"
        ref={projectInputRef}
        onChange={handleImportProject}
        accept=".json,.webols.json"
        className="hidden"
      />

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden relative">
        {hasAnyFile ? (
          <>
            {/* Sidebar */}
            <div className="w-56 bg-gray-850 border-r border-gray-700 flex flex-col shrink-0 bg-gray-800/50">
              {/* Sidebar tabs */}
              <div className="flex border-b border-gray-700 overflow-x-auto shrink-0">
                <button
                  onClick={() => setSidebarTab('tables')}
                  className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    sidebarTab === 'tables' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Tbl
                </button>
                {loadedFilesCount >= 2 && (
                  <button
                    onClick={() => setSidebarTab('diffs')}
                    className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                      sidebarTab === 'diffs' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    Diff
                  </button>
                )}
                <button
                  onClick={() => setSidebarTab('search')}
                  className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    sidebarTab === 'search' ? 'text-green-400 border-b-2 border-green-400' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Find
                </button>
                <button
                  onClick={() => setSidebarTab('finder')}
                  className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    sidebarTab === 'finder' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-gray-500 hover:text-gray-300'
                  }`}
                  title="Auto-detect maps"
                >
                  Auto
                </button>
                <button
                  onClick={() => setSidebarTab('rev')}
                  className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    sidebarTab === 'rev' ? 'text-red-400 border-b-2 border-red-400' : 'text-gray-500 hover:text-gray-300'
                  }`}
                  title="Find rev limiter"
                >
                  Rev
                </button>
                <button
                  onClick={() => setSidebarTab('map')}
                  className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    sidebarTab === 'map' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-gray-500 hover:text-gray-300'
                  }`}
                  title="MAP sensor finder"
                >
                  MAP
                </button>
                <button
                  onClick={() => setSidebarTab('checksum')}
                  className={`px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    sidebarTab === 'checksum' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-gray-500 hover:text-gray-300'
                  }`}
                  title="Checksum calculator"
                >
                  CS
                </button>
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-hidden flex flex-col">
                {sidebarTab === 'tables' && (
                  <div className="flex-1 overflow-y-auto">
                    <TableList
                      tables={tables}
                      selectedId={selectedTableId}
                      onSelect={handleSelectTable}
                      onEdit={handleEditTable}
                      onDelete={handleDeleteTable}
                      onGoToOffset={(offset) => {
                        setViewingTable(null)
                        setSelectedTableId(null)
                        hexViewerRef.current?.goToOffset(offset)
                      }}
                      onCopyTable={handleCopyWholeTable}
                    />
                  </div>
                )}

                {sidebarTab === 'diffs' && loadedFilesCount >= 2 && (
                  <DiffList
                    dataA={fileDataA}
                    dataB={fileDataB}
                    dataC={fileDataC}
                    onGoToOffset={(offset) => {
                      setViewingTable(null)
                      setSelectedTableId(null)
                      hexViewerRef.current?.goToOffset(offset)
                    }}
                    onViewAsTable={(range) => {
                      const cols = Math.min(16, range.size)
                      const rows = Math.ceil(range.size / cols)
                      setViewingTable({
                        id: `diff-${range.start}-${range.end}`,
                        name: `Diff @ 0x${range.start.toString(16).toUpperCase()}`,
                        offset: range.start,
                        rows,
                        cols,
                        dataType: 'u8',
                        isTemporary: true,
                      })
                      setSelectedTableId(null)
                    }}
                    onSaveAsTable={(tableData) => {
                      const newTable = {
                        id: Date.now().toString(),
                        name: tableData.name,
                        offset: tableData.offset,
                        rows: tableData.rows,
                        cols: tableData.cols,
                        dataType: tableData.dataType,
                      }
                      setTables(prev => [...prev, newTable])
                      setSidebarTab('tables')
                    }}
                  />
                )}

                {sidebarTab === 'search' && (
                  <SearchPanel
                    dataA={fileDataA}
                    dataB={fileDataB}
                    dataC={fileDataC}
                    endianness={endianness}
                    onGoToOffset={(offset) => {
                      setViewingTable(null)
                      setSelectedTableId(null)
                      hexViewerRef.current?.goToOffset(offset)
                    }}
                  />
                )}

                {sidebarTab === 'finder' && (
                  <MapFinder
                    dataA={fileDataA}
                    dataB={fileDataB}
                    dataC={fileDataC}
                    endianness={endianness}
                    onGoToOffset={(offset) => {
                      setViewingTable(null)
                      setSelectedTableId(null)
                      hexViewerRef.current?.goToOffset(offset)
                    }}
                    onViewAsTable={(range) => {
                      setViewingTable({
                        id: `found-${range.start}`,
                        name: `Map @ 0x${range.start.toString(16).toUpperCase()}`,
                        offset: range.start,
                        rows: range.rows,
                        cols: range.cols,
                        dataType: range.dataType,
                        isTemporary: true,
                      })
                      setSelectedTableId(null)
                    }}
                    onSaveAsTable={(tableData) => {
                      const newTable = {
                        id: Date.now().toString(),
                        name: tableData.name,
                        offset: tableData.offset,
                        rows: tableData.rows,
                        cols: tableData.cols,
                        dataType: tableData.dataType,
                      }
                      setTables(prev => [...prev, newTable])
                      setSidebarTab('tables')
                    }}
                  />
                )}

                {sidebarTab === 'rev' && (
                  <RevLimitFinder
                    dataA={fileDataA}
                    dataB={fileDataB}
                    dataC={fileDataC}
                    endianness={endianness}
                    onGoToOffset={(offset) => {
                      setViewingTable(null)
                      setSelectedTableId(null)
                      hexViewerRef.current?.goToOffset(offset)
                    }}
                  />
                )}

                {sidebarTab === 'map' && (
                  <MapSensorFinder
                    dataA={fileDataA}
                    dataB={fileDataB}
                    dataC={fileDataC}
                    endianness={endianness}
                    onGoToOffset={(offset) => {
                      setViewingTable(null)
                      setSelectedTableId(null)
                      hexViewerRef.current?.goToOffset(offset)
                    }}
                    onViewAsTable={(range) => {
                      setViewingTable({
                        id: `map-${range.start}`,
                        name: `MAP @ 0x${range.start.toString(16).toUpperCase()}`,
                        offset: range.start,
                        rows: range.rows,
                        cols: range.cols,
                        dataType: range.dataType,
                        isTemporary: true,
                      })
                      setSelectedTableId(null)
                    }}
                    onSaveAsTable={(tableData) => {
                      const newTable = {
                        id: Date.now().toString(),
                        name: tableData.name,
                        offset: tableData.offset,
                        rows: tableData.rows,
                        cols: tableData.cols,
                        dataType: tableData.dataType,
                      }
                      setTables(prev => [...prev, newTable])
                      setSidebarTab('tables')
                    }}
                  />
                )}

                {sidebarTab === 'checksum' && (
                  <ChecksumCalculator
                    dataA={fileDataA}
                    dataB={fileDataB}
                    dataC={fileDataC}
                    endianness={endianness}
                    onGoToOffset={(offset) => {
                      setViewingTable(null)
                      setSelectedTableId(null)
                      hexViewerRef.current?.goToOffset(offset)
                    }}
                    onUpdateData={(file, newData) => {
                      if (file === 'A') setFileDataA(newData)
                      else if (file === 'B') setFileDataB(newData)
                      else if (file === 'C') setFileDataC(newData)
                    }}
                  />
                )}
              </div>
            </div>

            {/* Main view area */}
            {viewingTable ? (
              <TableViewer
                table={viewingTable}
                dataA={fileDataA}
                dataB={fileDataB}
                dataC={fileDataC}
                formula={formula}
                tables={tables}
                endianness={endianness}
                clipboard={clipboard}
                onSetClipboard={setClipboard}
                onClose={() => {
                  setViewingTable(null)
                  setSelectedTableId(null)
                }}
                onUpdateTable={(updatedTable) => {
                  // Update in tables list if it's a saved table
                  if (!updatedTable.isTemporary) {
                    setTables(prev => prev.map(t => t.id === updatedTable.id ? updatedTable : t))
                  }
                  // Update the viewing table
                  setViewingTable(updatedTable)
                }}
                onUpdateBinary={(file, newData) => {
                  if (file === 'A') setFileDataA(newData)
                  else if (file === 'B') setFileDataB(newData)
                  else if (file === 'C') setFileDataC(newData)
                }}
              />
            ) : (
              <HexViewer
                ref={hexViewerRef}
                dataA={compareMode === 'diff' ? getDiffFiles().dataA : fileDataA}
                dataB={compareMode === 'diff' ? getDiffFiles().dataB : fileDataB}
                dataC={fileDataC}
                viewMode={viewMode}
                compareMode={compareMode}
                endianness={endianness}
                heatmapEnabled={heatmapEnabled}
                formula={formula}
                tables={tables}
                onSelectTable={(table) => {
                  setSelectedTableId(table.id)
                  setViewingTable(table)
                }}
              />
            )}

            {/* Table modal */}
            <TableModal
              isOpen={showTableModal}
              onClose={() => {
                setShowTableModal(false)
                setEditingTable(null)
              }}
              onSave={handleSaveTable}
              editTable={editingTable}
              tables={tables}
            />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4">
            <div>Open a file to view its hex contents</div>
            {(needsPermissionA || needsPermissionB || needsPermissionC) && (
              <div className="text-yellow-500 text-sm flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Click "Grant Access" above to restore access to your files
              </div>
            )}
            {!fsApiSupported && (
              <div className="text-gray-600 text-xs">
                Tip: Use Chrome or Edge for automatic file restoration
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
