import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const TYPE_SIZES = {
  u8: 1, i8: 1,
  u16: 2, i16: 2,
  u32: 4, i32: 4,
}

const TYPE_SIGNED = {
  u8: false, i8: true,
  u16: false, i16: true,
  u32: false, i32: true,
}

const DATA_TYPES = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32']

function TableViewer({ table, dataA, dataB, dataC, formula: globalFormula = '', onClose, onUpdateTable, onUpdateBinary, tables = [], endianness: globalEndianness = 'little', clipboard, onSetClipboard }) {
  // Prefer table-specific formula over global formula
  const formula = table.formula || globalFormula
  const loadedCount = [dataA, dataB, dataC].filter(Boolean).length
  const [viewMode, setViewMode] = useState(loadedCount >= 2 ? 'diff' : 'A')

  // Editing state
  const [editingCell, setEditingCell] = useState(null) // {row, col}
  const [editValue, setEditValue] = useState('')
  const [diffPair, setDiffPair] = useState('A-B') // 'A-B', 'A-C', 'B-C'
  const [displayDataType, setDisplayDataType] = useState(table.dataType) // Allow changing interpretation

  // Live offset adjustment
  const [liveOffset, setLiveOffset] = useState(table.offset)
  const [liveRows, setLiveRows] = useState(table.rows)
  const [liveCols, setLiveCols] = useState(table.cols)

  // Use table's endianness if set, otherwise fall back to global prop
  const tableEndianness = table.endianness || globalEndianness

  // Reset live values when table changes
  useEffect(() => {
    setLiveOffset(table.offset)
    setLiveRows(table.rows)
    setLiveCols(table.cols)
    setDisplayDataType(table.dataType)
    // Clear selection when switching tables
    setSelectionStart(null)
    setSelectionEnd(null)
  }, [table.offset, table.rows, table.cols, table.dataType, table.name])

  // Selection state
  const [selectionStart, setSelectionStart] = useState(null) // {row, col}
  const [selectionEnd, setSelectionEnd] = useState(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const containerRef = useRef(null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null) // {x, y}
  const [showInputModal, setShowInputModal] = useState(null) // 'absolute' | 'percent' | null
  const [inputValue, setInputValue] = useState('')

  const readValue = (data, offset, size, signed, isLittleEndian) => {
    if (!data || offset + size > data.length) return null
    let value = 0
    for (let i = 0; i < size; i++) {
      if (isLittleEndian) {
        value |= data[offset + i] << (i * 8)
      } else {
        value |= data[offset + i] << ((size - 1 - i) * 8)
      }
    }
    if (signed) {
      const maxUnsigned = 1 << (size * 8)
      const signBit = 1 << (size * 8 - 1)
      if (value >= signBit) {
        value = value - maxUnsigned
      }
    }
    return value
  }

  const writeValue = (data, offset, size, signed, isLittleEndian, value) => {
    if (!data || offset + size > data.length) return null

    // Handle signed values - convert to unsigned for storage
    let unsignedValue = value
    if (signed && value < 0) {
      const maxUnsigned = 1 << (size * 8)
      unsignedValue = maxUnsigned + value
    }

    // Create a copy of the data
    const newData = new Uint8Array(data)

    for (let i = 0; i < size; i++) {
      if (isLittleEndian) {
        newData[offset + i] = (unsignedValue >> (i * 8)) & 0xFF
      } else {
        newData[offset + i] = (unsignedValue >> ((size - 1 - i) * 8)) & 0xFF
      }
    }

    return newData
  }

  // Reverse formula to get raw value from display value
  const reverseFormula = useCallback((displayValue) => {
    if (!formula) return displayValue
    // Try to parse simple formulas like "x * a + b" or "x * a - b"
    // For now, just return the value - user enters raw value
    return displayValue
  }, [formula])

  const handleCellEdit = useCallback((row, col, newValue) => {
    if (viewMode === 'diff') return // Can't edit diff view

    const size = TYPE_SIZES[displayDataType]
    const signed = TYPE_SIGNED[displayDataType]
    const isLE = tableEndianness === 'little'
    const offset = liveOffset + (row * liveCols + col) * size

    const parsedValue = parseInt(newValue, 10)
    if (isNaN(parsedValue)) return

    // Get the current data and file letter
    const fileMap = { A: dataA, B: dataB, C: dataC }
    const currentData = fileMap[viewMode]
    if (!currentData) return

    const newData = writeValue(currentData, offset, size, signed, isLE, parsedValue)
    if (newData && onUpdateBinary) {
      onUpdateBinary(viewMode, newData)
    }

    setEditingCell(null)
    setEditValue('')
  }, [viewMode, displayDataType, tableEndianness, liveOffset, liveCols, dataA, dataB, dataC, onUpdateBinary])

  // Apply formula to value
  const applyFormula = useCallback((value) => {
    if (!formula || value === null) return value
    try {
      const x = value
      // eslint-disable-next-line no-new-func
      const result = new Function('x', `return ${formula}`)(x)
      return typeof result === 'number' && !isNaN(result) ? result : value
    } catch {
      return value
    }
  }, [formula])

  const formatDisplayValue = useCallback((value) => {
    if (value === null) return '??'
    const transformed = applyFormula(value)
    if (transformed === null) return '??'
    if (Number.isInteger(transformed)) {
      return transformed.toString()
    }
    return transformed.toFixed(2)
  }, [applyFormula])

  // Calculate effective dimensions based on display data type
  const effectiveDimensions = useMemo(() => {
    const originalSize = TYPE_SIZES[table.dataType]
    const newSize = TYPE_SIZES[displayDataType]
    const totalBytes = liveRows * liveCols * originalSize

    // Keep same column count, adjust rows
    const newCols = liveCols
    const newRows = Math.floor(totalBytes / (newCols * newSize))

    return { rows: Math.max(1, newRows), cols: newCols }
  }, [liveRows, liveCols, table.dataType, displayDataType])

  // Resolve axis values - either from hardcoded arrays or by reading from referenced tables
  const resolvedAxes = useMemo(() => {
    const resolveAxis = (tableId, hardcodedValues, count, isXAxis) => {
      if (tableId) {
        // Handle both string and number IDs (legacy tables have numeric IDs)
        const refTable = tables.find(t => t.id == tableId)
        console.log('Axis lookup:', { tableId, refTable: refTable?.name, allTableIds: tables.map(t => ({ id: t.id, name: t.name })) })
        if (refTable) {
          // Validate: axis table must be 1D (either 1 row OR 1 column)
          const is1D = refTable.rows === 1 || refTable.cols === 1
          if (!is1D) {
            console.warn('Axis table must be 1D (1 row or 1 column), got:', refTable.rows, 'x', refTable.cols)
            return hardcodedValues || null
          }

          const size = TYPE_SIZES[refTable.dataType]
          const signed = TYPE_SIGNED[refTable.dataType]
          // Use referenced table's endianness
          const refEndianness = refTable.endianness || globalEndianness
          const isLE = refEndianness === 'little'

          // Use the currently selected file's data
          const fileMap = { A: dataA, B: dataB, C: dataC }
          const sourceData = fileMap[viewMode]

          console.log('Reading axis data:', { refTable: refTable.name, viewMode, offset: refTable.offset, size, signed, isLE, hasData: !!sourceData, dataLength: sourceData?.length })
          if (sourceData) {
            const values = []
            // Total values in the axis table (either rows×1 or 1×cols)
            const maxValues = refTable.rows * refTable.cols
            for (let i = 0; i < count && i < maxValues; i++) {
              const val = readValue(
                sourceData,
                refTable.offset + i * size,
                size,
                signed,
                isLE
              )
              values.push(val)
            }
            console.log('Resolved axis values:', values)
            return values
          }
        }
      }
      return hardcodedValues || null
    }

    const result = {
      x: resolveAxis(table.xAxisTableId, table.xAxis, effectiveDimensions.cols, true),
      y: resolveAxis(table.yAxisTableId, table.yAxis, effectiveDimensions.rows, false),
    }
    console.log('Final resolved axes:', result)
    return result
  }, [table, tables, effectiveDimensions, dataA, dataB, dataC, globalEndianness, viewMode])

  const { valuesA, valuesB, valuesC, diffs, statsA, statsB, statsC, statsDiff } = useMemo(() => {
    const size = TYPE_SIZES[displayDataType]
    const signed = TYPE_SIGNED[displayDataType]
    const isLE = tableEndianness === 'little'
    const { rows, cols } = effectiveDimensions
    const valsA = []
    const valsB = []
    const valsC = []
    const diffVals = []
    let minA = Infinity, maxA = -Infinity
    let minB = Infinity, maxB = -Infinity
    let minC = Infinity, maxC = -Infinity
    let minDiff = Infinity, maxDiff = -Infinity
    let diffCount = 0

    // Determine which files to diff based on diffPair
    const files = { A: dataA, B: dataB, C: dataC }
    const [firstFile, secondFile] = diffPair.split('-')
    const diffDataFirst = files[firstFile]
    const diffDataSecond = files[secondFile]

    for (let r = 0; r < rows; r++) {
      const rowA = []
      const rowB = []
      const rowC = []
      const rowDiff = []
      for (let c = 0; c < cols; c++) {
        const offset = liveOffset + (r * cols + c) * size

        const valA = readValue(dataA, offset, size, signed, isLE)
        const valB = dataB ? readValue(dataB, offset, size, signed, isLE) : null
        const valC = dataC ? readValue(dataC, offset, size, signed, isLE) : null

        // Compute diff based on selected pair
        const valFirst = readValue(diffDataFirst, offset, size, signed, isLE)
        const valSecond = readValue(diffDataSecond, offset, size, signed, isLE)
        const diff = (valFirst !== null && valSecond !== null) ? valSecond - valFirst : null

        rowA.push(valA)
        rowB.push(valB)
        rowC.push(valC)
        rowDiff.push(diff)

        if (valA !== null) {
          minA = Math.min(minA, valA)
          maxA = Math.max(maxA, valA)
        }
        if (valB !== null) {
          minB = Math.min(minB, valB)
          maxB = Math.max(maxB, valB)
        }
        if (valC !== null) {
          minC = Math.min(minC, valC)
          maxC = Math.max(maxC, valC)
        }
        if (diff !== null) {
          minDiff = Math.min(minDiff, diff)
          maxDiff = Math.max(maxDiff, diff)
          if (diff !== 0) diffCount++
        }
      }
      valsA.push(rowA)
      valsB.push(rowB)
      valsC.push(rowC)
      diffVals.push(rowDiff)
    }

    return {
      valuesA: valsA,
      valuesB: valsB,
      valuesC: valsC,
      diffs: diffVals,
      statsA: { min: minA, max: maxA },
      statsB: { min: minB, max: maxB },
      statsC: { min: minC, max: maxC },
      statsDiff: { min: minDiff, max: maxDiff, count: diffCount, total: rows * cols }
    }
  }, [liveOffset, effectiveDimensions, displayDataType, dataA, dataB, dataC, diffPair, tableEndianness])

  const getValueColor = (value, min, max) => {
    if (value === null) return 'bg-gray-800'
    if (min === max) return 'rgb(59, 130, 246)'

    const ratio = (value - min) / (max - min)

    if (ratio < 0.25) {
      const t = ratio / 0.25
      return `rgb(${Math.round(0)}, ${Math.round(t * 200)}, ${Math.round(255 - t * 55)})`
    } else if (ratio < 0.5) {
      const t = (ratio - 0.25) / 0.25
      return `rgb(${Math.round(0)}, ${Math.round(200 + t * 55)}, ${Math.round(200 - t * 200)})`
    } else if (ratio < 0.75) {
      const t = (ratio - 0.5) / 0.25
      return `rgb(${Math.round(t * 255)}, ${Math.round(255)}, ${Math.round(0)})`
    } else {
      const t = (ratio - 0.75) / 0.25
      return `rgb(${Math.round(255)}, ${Math.round(255 - t * 255)}, ${Math.round(0)})`
    }
  }

  const getDiffColor = (diff) => {
    if (diff === null) return 'bg-gray-800'
    if (diff === 0) return 'rgb(55, 65, 81)' // gray-700

    const maxAbsDiff = Math.max(Math.abs(statsDiff.min), Math.abs(statsDiff.max))
    if (maxAbsDiff === 0) return 'rgb(55, 65, 81)'

    const intensity = Math.min(1, Math.abs(diff) / maxAbsDiff)

    if (diff > 0) {
      // Green for positive (value increased in B)
      return `rgb(${Math.round(20 + intensity * 20)}, ${Math.round(80 + intensity * 175)}, ${Math.round(20 + intensity * 80)})`
    } else {
      // Red for negative (value decreased in B)
      return `rgb(${Math.round(120 + intensity * 135)}, ${Math.round(30 + intensity * 30)}, ${Math.round(30 + intensity * 30)})`
    }
  }

  const getTextColor = (value, min, max, isDiff = false) => {
    if (value === null) return 'text-gray-500'
    if (isDiff) return 'text-white'
    const ratio = (value - min) / (max - min)
    return ratio > 0.4 && ratio < 0.8 ? 'text-gray-900' : 'text-white'
  }

  // Selection handlers
  const handleMouseDown = useCallback((row, col, e) => {
    if (e.button !== 0) return
    e.preventDefault()
    setSelectionStart({ row, col })
    setSelectionEnd({ row, col })
    setIsSelecting(true)
  }, [])

  const handleMouseMove = useCallback((row, col) => {
    if (isSelecting) {
      setSelectionEnd({ row, col })
    }
  }, [isSelecting])

  const handleMouseUp = useCallback(() => {
    setIsSelecting(false)
  }, [])

  const getSelectionBounds = useCallback(() => {
    if (!selectionStart || !selectionEnd) return null
    return {
      minRow: Math.min(selectionStart.row, selectionEnd.row),
      maxRow: Math.max(selectionStart.row, selectionEnd.row),
      minCol: Math.min(selectionStart.col, selectionEnd.col),
      maxCol: Math.max(selectionStart.col, selectionEnd.col),
    }
  }, [selectionStart, selectionEnd])

  const isInSelection = useCallback((row, col) => {
    const bounds = getSelectionBounds()
    if (!bounds) return false
    return row >= bounds.minRow && row <= bounds.maxRow &&
           col >= bounds.minCol && col <= bounds.maxCol
  }, [getSelectionBounds])

  const currentValues = viewMode === 'A' ? valuesA : viewMode === 'B' ? valuesB : viewMode === 'C' ? valuesC : diffs
  const currentStats = viewMode === 'A' ? statsA : viewMode === 'B' ? statsB : viewMode === 'C' ? statsC : statsDiff
  const isDiffMode = viewMode === 'diff'

  // Apply bulk operation to selected cells
  const applyBulkOperation = useCallback((operation, amount) => {
    if (isDiffMode || !onUpdateBinary) return

    const fileMap = { A: dataA, B: dataB, C: dataC }
    const currentData = fileMap[viewMode]
    if (!currentData) return

    const size = TYPE_SIZES[displayDataType]
    const signed = TYPE_SIGNED[displayDataType]
    const isLE = tableEndianness === 'little'
    const bounds = getSelectionBounds()
    if (!bounds) return

    const valuesMap = { A: valuesA, B: valuesB, C: valuesC }
    const vals = valuesMap[viewMode]

    let newData = new Uint8Array(currentData)

    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
      for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
        const offset = liveOffset + (r * liveCols + c) * size
        const oldValue = vals?.[r]?.[c]
        if (oldValue === null || oldValue === undefined) continue

        let newValue
        if (operation === 'absolute') {
          newValue = oldValue + amount
        } else if (operation === 'percent') {
          newValue = Math.round(oldValue * (1 + amount / 100))
        } else {
          continue
        }

        // Clamp to data type range
        if (!signed) {
          const maxVal = (1 << (size * 8)) - 1
          newValue = Math.max(0, Math.min(maxVal, newValue))
        } else {
          const maxVal = (1 << (size * 8 - 1)) - 1
          const minVal = -(1 << (size * 8 - 1))
          newValue = Math.max(minVal, Math.min(maxVal, newValue))
        }

        newData = writeValue(newData, offset, size, signed, isLE, newValue) || newData
      }
    }

    onUpdateBinary(viewMode, newData)
    setContextMenu(null)
  }, [isDiffMode, viewMode, dataA, dataB, dataC, displayDataType, tableEndianness, liveOffset, liveCols, getSelectionBounds, onUpdateBinary, valuesA, valuesB, valuesC])

  // Interpolate selected cells (bilinear interpolation from corners)
  const interpolateSelection = useCallback(() => {
    if (isDiffMode || !onUpdateBinary) return

    const fileMap = { A: dataA, B: dataB, C: dataC }
    const currentData = fileMap[viewMode]
    if (!currentData) return

    const size = TYPE_SIZES[displayDataType]
    const signed = TYPE_SIGNED[displayDataType]
    const isLE = tableEndianness === 'little'
    const bounds = getSelectionBounds()
    if (!bounds) return

    const valuesMap = { A: valuesA, B: valuesB, C: valuesC }
    const vals = valuesMap[viewMode]

    let newData = new Uint8Array(currentData)
    const rows = bounds.maxRow - bounds.minRow + 1
    const cols = bounds.maxCol - bounds.minCol + 1

    // Get corner values for bilinear interpolation
    const topLeft = vals?.[bounds.minRow]?.[bounds.minCol] ?? 0
    const topRight = vals?.[bounds.minRow]?.[bounds.maxCol] ?? 0
    const bottomLeft = vals?.[bounds.maxRow]?.[bounds.minCol] ?? 0
    const bottomRight = vals?.[bounds.maxRow]?.[bounds.maxCol] ?? 0

    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
      for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
        // Skip corners - keep original values
        if ((r === bounds.minRow || r === bounds.maxRow) &&
            (c === bounds.minCol || c === bounds.maxCol)) continue

        const offset = liveOffset + (r * liveCols + c) * size

        // Bilinear interpolation
        const rowRatio = rows > 1 ? (r - bounds.minRow) / (rows - 1) : 0
        const colRatio = cols > 1 ? (c - bounds.minCol) / (cols - 1) : 0

        const top = topLeft + (topRight - topLeft) * colRatio
        const bottom = bottomLeft + (bottomRight - bottomLeft) * colRatio
        let newValue = Math.round(top + (bottom - top) * rowRatio)

        // Clamp to data type range
        if (!signed) {
          const maxVal = (1 << (size * 8)) - 1
          newValue = Math.max(0, Math.min(maxVal, newValue))
        } else {
          const maxVal = (1 << (size * 8 - 1)) - 1
          const minVal = -(1 << (size * 8 - 1))
          newValue = Math.max(minVal, Math.min(maxVal, newValue))
        }

        newData = writeValue(newData, offset, size, signed, isLE, newValue) || newData
      }
    }

    onUpdateBinary(viewMode, newData)
    setContextMenu(null)
  }, [isDiffMode, viewMode, dataA, dataB, dataC, displayDataType, tableEndianness, liveOffset, liveCols, getSelectionBounds, onUpdateBinary, valuesA, valuesB, valuesC])

  // Handle context menu
  const handleContextMenu = useCallback((e, row, col) => {
    e.preventDefault()
    if (isDiffMode || !onUpdateBinary) return

    // If right-clicking on a cell and no selection, select that cell
    if (row !== undefined && col !== undefined) {
      if (!selectionStart || !selectionEnd) {
        setSelectionStart({ row, col })
        setSelectionEnd({ row, col })
      }
      setContextMenu({ x: e.clientX, y: e.clientY })
    } else if (selectionStart && selectionEnd) {
      setContextMenu({ x: e.clientX, y: e.clientY })
    }
  }, [selectionStart, selectionEnd, isDiffMode, onUpdateBinary])

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const copySelection = useCallback(async () => {
    const bounds = getSelectionBounds()
    if (!bounds) return

    // Copy formatted text to system clipboard (existing behavior)
    const lines = []
    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
      const rowValues = []
      for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
        const val = currentValues[r]?.[c]
        if (val !== null && val !== undefined) {
          rowValues.push(formula ? formatDisplayValue(val) : val.toString())
        } else {
          rowValues.push('??')
        }
      }
      lines.push(rowValues.join('\t'))
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
    } catch (err) {
      console.error('Failed to copy:', err)
    }

    // Store raw bytes in internal clipboard for cross-file paste
    if (onSetClipboard && !isDiffMode) {
      const size = TYPE_SIZES[displayDataType]
      const fileMap = { A: dataA, B: dataB, C: dataC }
      const sourceData = fileMap[viewMode]
      if (!sourceData) return

      const rows = bounds.maxRow - bounds.minRow + 1
      const cols = bounds.maxCol - bounds.minCol + 1
      const bytes = new Uint8Array(rows * cols * size)
      let idx = 0

      for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
        for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
          const offset = liveOffset + (r * liveCols + c) * size
          for (let b = 0; b < size; b++) {
            bytes[idx++] = sourceData[offset + b] ?? 0
          }
        }
      }

      onSetClipboard({
        tableId: table.id,
        sourceFile: viewMode,
        selection: { startRow: bounds.minRow, startCol: bounds.minCol, endRow: bounds.maxRow, endCol: bounds.maxCol },
        bytes,
      })
    }
  }, [getSelectionBounds, currentValues, formula, formatDisplayValue, onSetClipboard, isDiffMode, displayDataType, viewMode, dataA, dataB, dataC, liveOffset, liveCols, table.id])

  const canPaste = clipboard
    && clipboard.tableId === table.id
    && clipboard.sourceFile !== viewMode
    && !isDiffMode
    && viewMode !== 'diff'

  const pasteSelection = useCallback(() => {
    if (!canPaste || !onUpdateBinary) return

    const fileMap = { A: dataA, B: dataB, C: dataC }
    const targetData = fileMap[viewMode]
    if (!targetData) return

    const size = TYPE_SIZES[displayDataType]
    const { startRow, startCol, endRow, endCol } = clipboard.selection
    const newData = new Uint8Array(targetData)
    let idx = 0

    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const offset = liveOffset + (r * liveCols + c) * size
        for (let b = 0; b < size; b++) {
          if (offset + b < newData.length) {
            newData[offset + b] = clipboard.bytes[idx]
          }
          idx++
        }
      }
    }

    onUpdateBinary(viewMode, newData)
  }, [canPaste, clipboard, viewMode, dataA, dataB, dataC, displayDataType, liveOffset, liveCols, onUpdateBinary])

  // Keyboard handler
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'c' && e.ctrlKey && selectionStart) {
      e.preventDefault()
      copySelection()
    } else if (e.key === 'v' && e.ctrlKey) {
      e.preventDefault()
      pasteSelection()
    } else if (e.key === 'Escape') {
      setSelectionStart(null)
      setSelectionEnd(null)
    }
  }, [selectionStart, copySelection, pasteSelection])

  // Global mouse up
  useEffect(() => {
    const handleGlobalMouseUp = () => setIsSelecting(false)
    document.addEventListener('mouseup', handleGlobalMouseUp)
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [])

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex flex-col h-full bg-gray-900 flex-1 outline-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-gray-200 font-semibold">{table.name}</span>

          {/* Live offset controls */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-500">@</span>
            <button
              onClick={() => setLiveOffset(o => Math.max(0, o - TYPE_SIZES[displayDataType]))}
              className="px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
              title="Decrease offset by 1 element"
            >−</button>
            <input
              type="text"
              value={'0x' + liveOffset.toString(16).toUpperCase()}
              onChange={(e) => {
                const val = e.target.value.trim()
                const num = val.startsWith('0x') ? parseInt(val.slice(2), 16) : parseInt(val, 10)
                if (!isNaN(num) && num >= 0) setLiveOffset(num)
              }}
              className="w-20 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-gray-200 font-mono text-center"
            />
            <button
              onClick={() => setLiveOffset(o => o + TYPE_SIZES[displayDataType])}
              className="px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
              title="Increase offset by 1 element"
            >+</button>
          </div>

          {/* Live rows/cols controls */}
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => setLiveRows(r => Math.max(1, r - 1))}
              className="px-1 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs"
            >−</button>
            <span className="text-gray-400 font-mono w-6 text-center">{liveRows}</span>
            <button
              onClick={() => setLiveRows(r => r + 1)}
              className="px-1 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs"
            >+</button>
            <span className="text-gray-600">×</span>
            <button
              onClick={() => setLiveCols(c => Math.max(1, c - 1))}
              className="px-1 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs"
            >−</button>
            <span className="text-gray-400 font-mono w-6 text-center">{liveCols}</span>
            <button
              onClick={() => setLiveCols(c => c + 1)}
              className="px-1 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs"
            >+</button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Data type selector */}
          <div className="flex gap-1">
            {DATA_TYPES.map(dt => (
              <button
                key={dt}
                onClick={() => setDisplayDataType(dt)}
                className={`px-1.5 py-1 rounded text-xs font-mono transition-colors ${
                  displayDataType === dt ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                }`}
              >
                {dt.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Endianness toggle */}
          <div className="flex gap-1">
            <button
              onClick={() => onUpdateTable && onUpdateTable({ ...table, endianness: 'little' })}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                tableEndianness === 'little' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700'
              }`}
              title="Little Endian"
            >
              LE
            </button>
            <button
              onClick={() => onUpdateTable && onUpdateTable({ ...table, endianness: 'big' })}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                tableEndianness === 'big' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700'
              }`}
              title="Big Endian"
            >
              BE
            </button>
          </div>

          {/* View mode toggle */}
          {loadedCount >= 2 && (
            <div className="flex gap-1 items-center">
              {dataA && (
                <button
                  onClick={() => setViewMode('A')}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    viewMode === 'A' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  A
                </button>
              )}
              {dataB && (
                <button
                  onClick={() => setViewMode('B')}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    viewMode === 'B' ? 'bg-green-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  B
                </button>
              )}
              {dataC && (
                <button
                  onClick={() => setViewMode('C')}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    viewMode === 'C' ? 'bg-orange-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  C
                </button>
              )}
              <div className="w-px h-4 bg-gray-600 mx-1" />
              <button
                onClick={() => setViewMode('diff')}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  viewMode === 'diff' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:bg-gray-700'
                }`}
              >
                Diff
              </button>
              {viewMode === 'diff' && (
                <select
                  value={diffPair}
                  onChange={(e) => setDiffPair(e.target.value)}
                  className="bg-gray-700 text-gray-300 text-xs rounded px-1 py-1 outline-none"
                >
                  {dataA && dataB && <option value="A-B">A↔B</option>}
                  {dataA && dataC && <option value="A-C">A↔C</option>}
                  {dataB && dataC && <option value="B-C">B↔C</option>}
                </select>
              )}
            </div>
          )}
          {/* Save button - only show if values changed */}
          {onUpdateTable && (liveOffset !== table.offset || liveRows !== table.rows || liveCols !== table.cols || displayDataType !== table.dataType) && (
            <button
              onClick={() => onUpdateTable({
                ...table,
                offset: liveOffset,
                rows: liveRows,
                cols: liveCols,
                dataType: displayDataType,
              })}
              className="bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded text-xs font-medium"
              title="Save changes to table"
            >
              Save
            </button>
          )}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 p-1"
            title="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="px-4 py-2 border-b border-gray-700 flex items-center gap-4 shrink-0">
        {/* Axis warning */}
        {((table.xAxisTableId && !resolvedAxes.x) || (table.yAxisTableId && !resolvedAxes.y)) && (
          <span className="text-yellow-500 text-xs flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Axis data not found - check linked tables
          </span>
        )}
        {isDiffMode ? (
          <>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">Changes:</span>
              <span className="text-purple-400 font-mono">{statsDiff.count}</span>
              <span className="text-gray-600">/ {statsDiff.total}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">Range:</span>
              <span className="text-red-400 font-mono">{statsDiff.min}</span>
              <span className="text-gray-600">to</span>
              <span className="text-green-400 font-mono">+{statsDiff.max > 0 ? statsDiff.max : 0}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className="w-4 h-3 rounded" style={{ backgroundColor: 'rgb(255, 60, 60)' }} />
              <span>Decreased</span>
              <div className="w-4 h-3 rounded bg-gray-700 ml-2" />
              <span>Same</span>
              <div className="w-4 h-3 rounded ml-2" style={{ backgroundColor: 'rgb(40, 255, 100)' }} />
              <span>Increased</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>Min: <span className="text-cyan-400 font-mono">{currentStats.min}</span></span>
              <span>Max: <span className="text-red-400 font-mono">{currentStats.max}</span></span>
            </div>
            <div className="flex h-4 w-48 rounded overflow-hidden">
              {[...Array(20)].map((_, i) => {
                const ratio = i / 19
                const value = currentStats.min + ratio * (currentStats.max - currentStats.min)
                return (
                  <div
                    key={i}
                    className="flex-1"
                    style={{ backgroundColor: getValueColor(value, currentStats.min, currentStats.max) }}
                  />
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Table grid */}
      <div className="flex-1 overflow-auto p-4">
        <div className="inline-block">
          <table className="border-collapse">
            <tbody>
              {currentValues.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td className="px-2 py-1 text-gray-500 text-xs font-mono text-right border-r border-gray-700 sticky left-0 bg-gray-900">
                    {resolvedAxes.y?.[rowIndex] ?? rowIndex}
                  </td>
                  {row.map((value, colIndex) => {
                    const bgColor = isDiffMode
                      ? getDiffColor(value)
                      : getValueColor(value, currentStats.min, currentStats.max)
                    const textColor = getTextColor(value, currentStats.min, currentStats.max, isDiffMode)

                    const valA = valuesA[rowIndex]?.[colIndex]
                    const valB = valuesB[rowIndex]?.[colIndex]
                    const valC = valuesC[rowIndex]?.[colIndex]
                    const diff = diffs[rowIndex]?.[colIndex]

                    let tooltip = `[${resolvedAxes.y?.[rowIndex] ?? rowIndex}, ${resolvedAxes.x?.[colIndex] ?? colIndex}]\n`
                    tooltip += `Row: ${rowIndex}, Col: ${colIndex}\n`
                    tooltip += `Offset: 0x${(liveOffset + (rowIndex * effectiveDimensions.cols + colIndex) * TYPE_SIZES[displayDataType]).toString(16).toUpperCase()}\n`
                    if (dataA) tooltip += `File A: ${valA}\n`
                    if (dataB) tooltip += `File B: ${valB}\n`
                    if (dataC) tooltip += `File C: ${valC}\n`
                    if (loadedCount >= 2 && diff !== null) tooltip += `Diff (${diffPair}): ${diff > 0 ? '+' : ''}${diff}`

                    const displayValue = isDiffMode
                      ? (value === null ? '??' : value === 0 ? '0' : (value > 0 ? `+${value}` : value))
                      : (value !== null ? (formula ? formatDisplayValue(value) : value) : '??')

                    const isSelected = isInSelection(rowIndex, colIndex)
                    const cellBgColor = isSelected
                      ? 'rgb(202, 138, 4)' // yellow-600
                      : (typeof bgColor === 'string' && bgColor.startsWith('rgb') ? bgColor : undefined)

                    const isEditing = editingCell?.row === rowIndex && editingCell?.col === colIndex
                    const canEdit = !isDiffMode && onUpdateBinary

                    return (
                      <td
                        key={colIndex}
                        className={`px-2 py-1 text-center font-mono text-sm border border-gray-700/50 min-w-[3rem] select-none ${canEdit ? 'cursor-pointer' : ''} ${isSelected ? 'text-white' : textColor}`}
                        style={{ backgroundColor: cellBgColor }}
                        title={tooltip}
                        onMouseDown={(e) => {
                          if (!isEditing) handleMouseDown(rowIndex, colIndex, e)
                        }}
                        onMouseMove={() => handleMouseMove(rowIndex, colIndex)}
                        onMouseUp={handleMouseUp}
                        onContextMenu={(e) => handleContextMenu(e, rowIndex, colIndex)}
                        onDoubleClick={() => {
                          if (canEdit) {
                            setEditingCell({ row: rowIndex, col: colIndex })
                            // Get raw value for editing
                            const rawValue = viewMode === 'A' ? valuesA[rowIndex]?.[colIndex]
                              : viewMode === 'B' ? valuesB[rowIndex]?.[colIndex]
                              : valuesC[rowIndex]?.[colIndex]
                            setEditValue(rawValue?.toString() || '0')
                          }
                        }}
                      >
                        {isEditing ? (
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => {
                              handleCellEdit(rowIndex, colIndex, editValue)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleCellEdit(rowIndex, colIndex, editValue)
                              } else if (e.key === 'Escape') {
                                setEditingCell(null)
                                setEditValue('')
                              }
                            }}
                            className="w-full bg-gray-900 border border-blue-500 rounded px-1 text-center text-white outline-none"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          />
                        ) : (
                          displayValue
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="px-2 py-1 text-gray-600 text-xs sticky left-0 bg-gray-900">#</td>
                {currentValues[0]?.map((_, colIndex) => (
                  <td key={colIndex} className="px-2 py-1 text-gray-500 text-xs font-mono text-center">
                    {resolvedAxes.x?.[colIndex] ?? colIndex}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Selection info bar */}
        {(selectionStart && selectionEnd || canPaste) && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 shadow-xl flex items-center gap-3 text-sm z-50">
            {selectionStart && selectionEnd && (
              <>
                <span className="text-gray-400">
                  {(() => {
                    const bounds = getSelectionBounds()
                    if (!bounds) return ''
                    const rows = bounds.maxRow - bounds.minRow + 1
                    const cols = bounds.maxCol - bounds.minCol + 1
                    return `${rows}×${cols} cells`
                  })()}
                </span>
                <button
                  onClick={copySelection}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-0.5 rounded text-xs flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </button>
                <span className="text-gray-600 text-xs">Ctrl+C</span>
              </>
            )}
            {canPaste && (
              <>
                {selectionStart && selectionEnd && <div className="w-px h-4 bg-gray-600" />}
                <button
                  onClick={pasteSelection}
                  className="bg-green-600 hover:bg-green-500 text-white px-2 py-0.5 rounded text-xs flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Paste from {clipboard.sourceFile}
                </button>
                <span className="text-gray-600 text-xs">Ctrl+V</span>
              </>
            )}
            {selectionStart && selectionEnd && (
              <button
                onClick={() => { setSelectionStart(null); setSelectionEnd(null) }}
                className="text-gray-500 hover:text-gray-300"
                title="Clear selection (Esc)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Context menu */}
        {contextMenu && (
          <div
            className="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[180px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setShowInputModal('absolute')
                setInputValue('')
                setContextMenu(null)
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
            >
              <span className="text-blue-400">±</span>
              Add/Subtract Value
            </button>
            <button
              onClick={() => {
                setShowInputModal('percent')
                setInputValue('')
                setContextMenu(null)
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
            >
              <span className="text-green-400">%</span>
              Change by Percent
            </button>
            <div className="h-px bg-gray-700 my-1" />
            <button
              onClick={() => {
                interpolateSelection()
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
            >
              <span className="text-purple-400">⟋</span>
              Interpolate (from corners)
            </button>
            <div className="h-px bg-gray-700 my-1" />
            <button
              onClick={() => {
                copySelection()
                setContextMenu(null)
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
            >
              <span className="text-gray-400">⎘</span>
              Copy
            </button>
            {canPaste && (
              <button
                onClick={() => {
                  pasteSelection()
                  setContextMenu(null)
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
              >
                <span className="text-green-400">📋</span>
                Paste from File {clipboard.sourceFile}
              </button>
            )}
          </div>
        )}

        {/* Input modal for value operations */}
        {showInputModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-800 border border-gray-600 rounded-lg p-4 shadow-xl w-72">
              <div className="text-gray-300 text-sm font-semibold mb-3">
                {showInputModal === 'absolute' ? 'Add/Subtract Value' : 'Change by Percent'}
              </div>
              <div className="text-gray-500 text-xs mb-2">
                {showInputModal === 'absolute'
                  ? 'Enter value to add (use negative to subtract)'
                  : 'Enter percentage change (e.g., 10 for +10%, -5 for -5%)'}
              </div>
              <input
                type="number"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={showInputModal === 'absolute' ? 'e.g., 10 or -5' : 'e.g., 10 or -5'}
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-gray-200 text-sm outline-none focus:border-blue-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const amount = parseFloat(inputValue)
                    if (!isNaN(amount)) {
                      applyBulkOperation(showInputModal, amount)
                    }
                    setShowInputModal(null)
                  } else if (e.key === 'Escape') {
                    setShowInputModal(null)
                  }
                }}
              />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    const amount = parseFloat(inputValue)
                    if (!isNaN(amount)) {
                      applyBulkOperation(showInputModal, amount)
                    }
                    setShowInputModal(null)
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm"
                >
                  Apply
                </button>
                <button
                  onClick={() => setShowInputModal(null)}
                  className="flex-1 bg-gray-600 hover:bg-gray-500 text-white px-3 py-1.5 rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default TableViewer
