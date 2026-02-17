import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

const BYTES_PER_ROW = 16
const VISIBLE_ROWS = 32

const VIEW_MODES = {
  hex: { label: 'Hex', size: 1, perRow: 16, width: 'w-8', signed: false },
  u8: { label: 'U8', size: 1, perRow: 16, width: 'w-14', signed: false },
  i8: { label: 'I8', size: 1, perRow: 16, width: 'w-14', signed: true },
  u16: { label: 'U16', size: 2, perRow: 8, width: 'w-16', signed: false },
  i16: { label: 'I16', size: 2, perRow: 8, width: 'w-16', signed: true },
  u32: { label: 'U32', size: 4, perRow: 4, width: 'w-24', signed: false },
  i32: { label: 'I32', size: 4, perRow: 4, width: 'w-24', signed: true },
}

const HexViewer = forwardRef(function HexViewer({
  data,
  dataA,
  dataB,
  dataC,
  viewMode = 'hex',
  compareMode = 'A', // 'A', 'B', 'C', or 'diff'
  endianness = 'little', // 'little' or 'big'
  heatmapEnabled = false,
  formula = ''
}, ref) {
  const containerRef = useRef(null)
  const [cursorPos, setCursorPos] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [showGoTo, setShowGoTo] = useState(false)
  const [goToValue, setGoToValue] = useState('')
  const goToInputRef = useRef(null)

  // Selection state
  const [selectionStart, setSelectionStart] = useState(null)
  const [selectionEnd, setSelectionEnd] = useState(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const copySelectionRef = useRef(null)

  // Support both old single-file API and new multi-file API
  const fileA = dataA || data
  const fileB = dataB
  const fileC = dataC
  const activeData = compareMode === 'C' && fileC ? fileC : compareMode === 'B' && fileB ? fileB : fileA
  const hasBothFiles = fileA && fileB
  const isDiffMode = compareMode === 'diff' && hasBothFiles

  const mode = VIEW_MODES[viewMode] || VIEW_MODES.hex
  const itemsPerRow = mode.perRow
  const itemSize = mode.size
  const bytesPerRow = itemsPerRow * itemSize

  const maxLength = Math.max(fileA?.length || 0, fileB?.length || 0, fileC?.length || 0)
  const totalRows = Math.ceil(maxLength / bytesPerRow)

  const goToOffset = useCallback((offset) => {
    const pos = Math.max(0, Math.min(maxLength - 1, offset))
    setCursorPos(pos)
    const row = Math.floor(pos / bytesPerRow)
    setScrollOffset(Math.max(0, Math.min(totalRows - VISIBLE_ROWS, row - Math.floor(VISIBLE_ROWS / 2))))
  }, [maxLength, totalRows, bytesPerRow])

  const parseOffset = (value) => {
    const trimmed = value.trim().toLowerCase()
    if (trimmed.startsWith('0x')) {
      return parseInt(trimmed.slice(2), 16)
    } else if (trimmed.endsWith('h')) {
      return parseInt(trimmed.slice(0, -1), 16)
    }
    return parseInt(trimmed, 10)
  }

  const handleGoToSubmit = (e) => {
    e.preventDefault()
    const offset = parseOffset(goToValue)
    if (!isNaN(offset)) {
      goToOffset(offset)
    }
    setShowGoTo(false)
    setGoToValue('')
    containerRef.current?.focus()
  }

  const openGoToDialog = useCallback(() => {
    setGoToValue(cursorPos.toString(16).toUpperCase())
    setShowGoTo(true)
    setTimeout(() => goToInputRef.current?.select(), 0)
  }, [cursorPos])

  useImperativeHandle(ref, () => ({
    goToOffset,
    openGoToDialog,
  }), [goToOffset, openGoToDialog])

  const ensureCursorVisible = useCallback((pos) => {
    const cursorRow = Math.floor(pos / bytesPerRow)
    if (cursorRow < scrollOffset) {
      setScrollOffset(cursorRow)
    } else if (cursorRow >= scrollOffset + VISIBLE_ROWS) {
      setScrollOffset(cursorRow - VISIBLE_ROWS + 1)
    }
  }, [scrollOffset, bytesPerRow])

  const handleKeyDown = useCallback((e) => {
    let newPos = cursorPos

    switch (e.key) {
      case 'ArrowUp':
        newPos = Math.max(0, cursorPos - bytesPerRow)
        e.preventDefault()
        break
      case 'ArrowDown':
        newPos = Math.min(maxLength - 1, cursorPos + bytesPerRow)
        e.preventDefault()
        break
      case 'ArrowLeft':
        newPos = Math.max(0, cursorPos - itemSize)
        e.preventDefault()
        break
      case 'ArrowRight':
        newPos = Math.min(maxLength - 1, cursorPos + itemSize)
        e.preventDefault()
        break
      case 'PageUp':
        newPos = Math.max(0, cursorPos - bytesPerRow * VISIBLE_ROWS)
        e.preventDefault()
        break
      case 'PageDown':
        newPos = Math.min(maxLength - 1, cursorPos + bytesPerRow * VISIBLE_ROWS)
        e.preventDefault()
        break
      case 'Home':
        if (e.ctrlKey) {
          newPos = 0
        } else {
          newPos = Math.floor(cursorPos / bytesPerRow) * bytesPerRow
        }
        e.preventDefault()
        break
      case 'End':
        if (e.ctrlKey) {
          newPos = maxLength - 1
        } else {
          newPos = Math.min(maxLength - 1, Math.floor(cursorPos / bytesPerRow) * bytesPerRow + bytesPerRow - itemSize)
        }
        e.preventDefault()
        break
      case 'g':
        if (e.ctrlKey) {
          e.preventDefault()
          openGoToDialog()
          return
        }
        return
      case 'c':
        if (e.ctrlKey && selectionStart !== null) {
          e.preventDefault()
          copySelectionRef.current?.()
          return
        }
        return
      case 'Escape':
        setSelectionStart(null)
        setSelectionEnd(null)
        return
      default:
        return
    }

    setCursorPos(newPos)
    ensureCursorVisible(newPos)
  }, [cursorPos, maxLength, ensureCursorVisible, bytesPerRow, itemSize, openGoToDialog, selectionStart])

  const handleByteClick = useCallback((index) => {
    setCursorPos(index)
    containerRef.current?.focus()
  }, [])

  // Selection handlers
  const handleMouseDown = useCallback((index, e) => {
    if (e.button !== 0) return // Left click only
    e.preventDefault()
    setSelectionStart(index)
    setSelectionEnd(index)
    setIsSelecting(true)
    setCursorPos(index)
  }, [])

  const handleMouseMove = useCallback((index) => {
    if (isSelecting) {
      setSelectionEnd(index)
    }
  }, [isSelecting])

  const handleMouseUp = useCallback(() => {
    setIsSelecting(false)
  }, [])

  // Get selection bounds as rectangle (row/col based)
  const getSelectionBounds = useCallback(() => {
    if (selectionStart === null || selectionEnd === null) return null

    const startRow = Math.floor(selectionStart / bytesPerRow)
    const startCol = Math.floor((selectionStart % bytesPerRow) / itemSize)
    const endRow = Math.floor(selectionEnd / bytesPerRow)
    const endCol = Math.floor((selectionEnd % bytesPerRow) / itemSize)

    return {
      minRow: Math.min(startRow, endRow),
      maxRow: Math.max(startRow, endRow),
      minCol: Math.min(startCol, endCol),
      maxCol: Math.max(startCol, endCol),
    }
  }, [selectionStart, selectionEnd, bytesPerRow, itemSize])

  const isInSelection = useCallback((index) => {
    const bounds = getSelectionBounds()
    if (!bounds) return false

    const row = Math.floor(index / bytesPerRow)
    const col = Math.floor((index % bytesPerRow) / itemSize)

    return row >= bounds.minRow && row <= bounds.maxRow &&
           col >= bounds.minCol && col <= bounds.maxCol
  }, [getSelectionBounds, bytesPerRow, itemSize])

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

  // Format value for display (with formula applied)
  const formatDisplayValue = useCallback((value) => {
    if (value === null) return '??'
    const transformed = applyFormula(value)
    if (transformed === null) return '??'
    if (Number.isInteger(transformed)) {
      return transformed.toString()
    }
    return transformed.toFixed(2)
  }, [applyFormula])

  // Copy selection to clipboard - clean values only
  const copySelection = useCallback(async () => {
    const bounds = getSelectionBounds()
    if (!bounds || !activeData) return

    const { minRow, maxRow, minCol, maxCol } = bounds
    const lines = []

    for (let r = minRow; r <= maxRow; r++) {
      const rowValues = []
      for (let c = minCol; c <= maxCol; c++) {
        const byteIndex = r * bytesPerRow + c * itemSize

        if (viewMode === 'hex') {
          const byte = activeData[byteIndex]
          rowValues.push(byte !== undefined ? byte.toString(16).toUpperCase().padStart(2, '0') : '??')
        } else {
          const val = readValue(activeData, byteIndex, itemSize, mode.signed)
          if (val !== null) {
            rowValues.push(formula ? formatDisplayValue(val) : val.toString())
          } else {
            rowValues.push('??')
          }
        }
      }
      lines.push(rowValues.join('\t'))
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'))
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [getSelectionBounds, activeData, bytesPerRow, itemSize, viewMode, mode, formula, formatDisplayValue])

  // Keep ref updated for keyboard handler
  copySelectionRef.current = copySelection

  useEffect(() => {
    containerRef.current?.focus()
  }, [fileA, fileB])

  // Handle mouse up outside component
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsSelecting(false)
    }
    document.addEventListener('mouseup', handleGlobalMouseUp)
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [])

  // Wheel event with passive: false to allow preventDefault
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const wheelHandler = (e) => {
      e.preventDefault()
      const delta = Math.sign(e.deltaY) * 3
      setScrollOffset(prev => Math.max(0, Math.min(totalRows - VISIBLE_ROWS, prev + delta)))
    }

    container.addEventListener('wheel', wheelHandler, { passive: false })
    return () => container.removeEventListener('wheel', wheelHandler)
  }, [totalRows])

  const toHex = (byte) => byte !== undefined ? byte.toString(16).padStart(2, '0').toUpperCase() : '??'
  const toAscii = (byte) => (byte >= 0x20 && byte <= 0x7e) ? String.fromCharCode(byte) : '.'

  const isLE = endianness === 'little'

  const readValue = (data, offset, size, signed) => {
    if (!data || offset + size > data.length) return null
    let value = 0
    for (let i = 0; i < size; i++) {
      if (isLE) {
        value |= data[offset + i] << (i * 8)
      } else {
        value |= data[offset + i] << ((size - 1 - i) * 8)
      }
    }
    if (signed) {
      const maxVal = 1 << (size * 8)
      const signBit = 1 << (size * 8 - 1)
      if (value >= signBit) {
        value = value - maxVal
      }
    }
    return value
  }

  const formatValue = (data, offset) => {
    if (!data || offset >= data.length) return '??'
    if (viewMode === 'hex') {
      return toHex(data[offset])
    }
    const value = readValue(data, offset, itemSize, mode.signed)
    if (value === null) return '??'
    if (formula) {
      return formatDisplayValue(value)
    }
    return value.toString()
  }

  const formatDiffValue = (offset) => {
    const valA = readValue(fileA, offset, itemSize, mode.signed)
    const valB = readValue(fileB, offset, itemSize, mode.signed)
    if (valA === null || valB === null) return { display: '??', diff: null }
    const diff = valB - valA
    if (viewMode === 'hex') {
      // In hex mode, show the actual diff value
      if (diff === 0) return { display: '00', diff: 0 }
      const absDiff = Math.abs(diff)
      const prefix = diff > 0 ? '+' : '-'
      return { display: prefix + absDiff.toString(16).toUpperCase().padStart(2, '0').slice(-2), diff }
    }
    return { display: diff === 0 ? '0' : (diff > 0 ? `+${diff}` : `${diff}`), diff }
  }

  const getDiffColor = (diff) => {
    if (diff === null) return ''
    if (diff === 0) return 'text-gray-500'
    if (diff > 0) return 'text-green-400'
    return 'text-red-400'
  }

  const getDiffBgColor = (diff) => {
    if (diff === null) return 'bg-gray-800'
    if (diff === 0) return ''
    if (diff > 0) return 'bg-green-900/50'
    return 'bg-red-900/50'
  }

  // Heatmap color gradient (blue -> cyan -> green -> yellow -> red)
  const getValueColor = (value, min, max) => {
    if (value === null || value === undefined) return null
    if (min === max) return 'rgb(59, 130, 246)' // blue if all same

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

  // Get text color for heatmap (dark text on bright backgrounds)
  const getHeatmapTextColor = (value, min, max) => {
    if (value === null || value === undefined || min === max) return 'text-white'
    const ratio = (value - min) / (max - min)
    return ratio > 0.4 && ratio < 0.8 ? 'text-gray-900' : 'text-white'
  }

  // Calculate min/max for visible rows (for heatmap)
  const { heatmapMin, heatmapMax } = useMemo(() => {
    if (!heatmapEnabled || !activeData || isDiffMode) {
      return { heatmapMin: 0, heatmapMax: 255 }
    }

    let min = Infinity
    let max = -Infinity

    for (let i = 0; i < VISIBLE_ROWS && (scrollOffset + i) * bytesPerRow < maxLength; i++) {
      const rowStart = (scrollOffset + i) * bytesPerRow
      for (let j = 0; j < itemsPerRow; j++) {
        const byteIndex = rowStart + j * itemSize
        if (byteIndex < maxLength) {
          const val = readValue(activeData, byteIndex, itemSize, mode.signed)
          if (val !== null) {
            min = Math.min(min, val)
            max = Math.max(max, val)
          }
        }
      }
    }

    return {
      heatmapMin: min === Infinity ? 0 : min,
      heatmapMax: max === -Infinity ? 255 : max
    }
  }, [heatmapEnabled, activeData, scrollOffset, bytesPerRow, maxLength, itemsPerRow, itemSize, mode.signed, isDiffMode])

  const rows = []
  for (let i = 0; i < VISIBLE_ROWS && (scrollOffset + i) * bytesPerRow < maxLength; i++) {
    const rowStart = (scrollOffset + i) * bytesPerRow
    const rowItems = []
    for (let j = 0; j < itemsPerRow; j++) {
      const byteIndex = rowStart + j * itemSize
      if (byteIndex < maxLength) {
        if (isDiffMode) {
          const { display, diff } = formatDiffValue(byteIndex)
          rowItems.push({ index: byteIndex, value: display, diff, rawValue: null })
        } else {
          const rawValue = readValue(activeData, byteIndex, itemSize, mode.signed)
          rowItems.push({ index: byteIndex, value: formatValue(activeData, byteIndex), diff: null, rawValue })
        }
      }
    }
    rows.push({ offset: rowStart, items: rowItems })
  }

  // For ASCII column
  const getRowBytes = (rowStart) => {
    const bytes = []
    for (let j = 0; j < bytesPerRow && rowStart + j < maxLength; j++) {
      const idx = rowStart + j
      const byteA = fileA && idx < fileA.length ? fileA[idx] : undefined
      const byteB = fileB && idx < fileB.length ? fileB[idx] : undefined
      const diff = (byteA !== undefined && byteB !== undefined) ? byteB - byteA : null

      let displayByte
      if (isDiffMode) {
        displayByte = byteA // Show file A's ASCII in diff mode
      } else if (compareMode === 'B' && fileB) {
        displayByte = byteB
      } else {
        displayByte = byteA
      }

      bytes.push({ index: idx, value: displayByte, diff })
    }
    return bytes
  }

  const scrollbarHeight = totalRows > VISIBLE_ROWS
    ? Math.max(20, (VISIBLE_ROWS / totalRows) * 100)
    : 100
  const scrollbarTop = totalRows > VISIBLE_ROWS
    ? (scrollOffset / (totalRows - VISIBLE_ROWS)) * (100 - scrollbarHeight)
    : 0

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex-1 bg-gray-900 font-mono text-sm outline-none select-none overflow-hidden flex relative"
    >
      <div className="flex-1 overflow-hidden">
        {rows.map((row) => {
          const rowBytes = getRowBytes(row.offset)
          const isSelected = (index) => index >= cursorPos && index < cursorPos + itemSize

          return (
            <div key={row.offset} className="flex h-6 leading-6">
              {/* Offset column */}
              <div className="w-24 text-gray-500 text-right pr-4 shrink-0">
                {row.offset.toString(16).padStart(8, '0').toUpperCase()}
              </div>

              {/* Data values */}
              <div className="flex gap-0.5 shrink-0">
                {row.items.map((item, j) => {
                  const isCurrentPos = item.index === cursorPos
                  const isSelected = isInSelection(item.index)
                  const useHeatmap = heatmapEnabled && !isDiffMode && item.rawValue !== null && !isSelected
                  let className = `${mode.width} text-center cursor-pointer select-none `
                  let style = undefined

                  if (isSelected && !isCurrentPos) {
                    className += 'bg-yellow-600/70 text-white'
                  } else if (isCurrentPos) {
                    className += 'bg-blue-600 text-white'
                  } else if (isDiffMode) {
                    className += getDiffBgColor(item.diff) + ' ' + getDiffColor(item.diff) + ' hover:bg-gray-700'
                  } else if (useHeatmap) {
                    const bgColor = getValueColor(item.rawValue, heatmapMin, heatmapMax)
                    style = { backgroundColor: bgColor }
                    className += getHeatmapTextColor(item.rawValue, heatmapMin, heatmapMax)
                  } else {
                    className += 'text-green-400 hover:bg-gray-700'
                  }

                  if (j === Math.floor(itemsPerRow / 2) - 1) {
                    className += ' mr-2'
                  }

                  return (
                    <span
                      key={item.index}
                      onMouseDown={(e) => handleMouseDown(item.index, e)}
                      onMouseMove={() => handleMouseMove(item.index)}
                      onMouseUp={handleMouseUp}
                      className={className}
                      style={style}
                      title={isDiffMode && item.diff !== null ? `Diff: ${item.diff > 0 ? '+' : ''}${item.diff}` : undefined}
                    >
                      {item.value}
                    </span>
                  )
                })}
                {/* Pad empty items for alignment */}
                {row.items.length < itemsPerRow &&
                  Array(itemsPerRow - row.items.length).fill(0).map((_, j) => (
                    <span key={`empty-${j}`} className={`${mode.width} ${row.items.length + j === Math.floor(itemsPerRow / 2) - 1 ? 'mr-2' : ''}`} />
                  ))
                }
              </div>

              {/* Separator */}
              <div className="w-4 shrink-0" />

              {/* ASCII column */}
              <div className="flex shrink-0">
                {rowBytes.map((byte) => {
                  const isCursorPos = isSelected(byte.index)
                  const byteSelected = isInSelection(Math.floor(byte.index / itemSize) * itemSize)
                  const useHeatmap = heatmapEnabled && !isDiffMode && byte.value !== undefined && !byteSelected
                  let className = 'w-2.5 text-center cursor-pointer select-none '
                  let style = undefined

                  if (byteSelected && !isCursorPos) {
                    className += 'bg-yellow-600/70 text-white'
                  } else if (isCursorPos) {
                    className += 'bg-blue-600 text-white'
                  } else if (isDiffMode && byte.diff !== null && byte.diff !== 0) {
                    className += byte.diff > 0 ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/30'
                  } else if (useHeatmap) {
                    // For ASCII column, use byte value directly (always u8)
                    const bgColor = getValueColor(byte.value, heatmapMin, heatmapMax)
                    style = { backgroundColor: bgColor }
                    className += getHeatmapTextColor(byte.value, heatmapMin, heatmapMax)
                  } else if (byte.value >= 0x20 && byte.value <= 0x7e) {
                    className += 'text-cyan-400 hover:bg-gray-700'
                  } else {
                    className += 'text-gray-600 hover:bg-gray-700'
                  }

                  return (
                    <span
                      key={byte.index}
                      onClick={() => handleByteClick(Math.floor(byte.index / itemSize) * itemSize)}
                      className={className}
                      style={style}
                    >
                      {byte.value !== undefined ? toAscii(byte.value) : '?'}
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Scrollbar */}
      {totalRows > VISIBLE_ROWS && (
        <div className="w-3 bg-gray-800 relative">
          <div
            className="absolute w-full bg-gray-600 rounded"
            style={{
              height: `${scrollbarHeight}%`,
              top: `${scrollbarTop}%`,
            }}
          />
        </div>
      )}

      {/* Selection info bar */}
      {selectionStart !== null && selectionEnd !== null && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 shadow-xl flex items-center gap-3 text-sm">
          <span className="text-gray-400">
            {(() => {
              const bounds = getSelectionBounds()
              if (!bounds) return ''
              const rows = bounds.maxRow - bounds.minRow + 1
              const cols = bounds.maxCol - bounds.minCol + 1
              const startOffset = bounds.minRow * bytesPerRow + bounds.minCol * itemSize
              return `${rows}×${cols} @ 0x${startOffset.toString(16).toUpperCase()}`
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
          <button
            onClick={() => { setSelectionStart(null); setSelectionEnd(null) }}
            className="text-gray-500 hover:text-gray-300"
            title="Clear selection (Esc)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Go to offset dialog */}
      {showGoTo && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <form onSubmit={handleGoToSubmit} className="bg-gray-800 border border-gray-600 rounded-lg p-4 shadow-xl">
            <div className="text-gray-300 text-sm mb-2">Go to offset</div>
            <input
              ref={goToInputRef}
              type="text"
              value={goToValue}
              onChange={(e) => setGoToValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowGoTo(false)
                  containerRef.current?.focus()
                }
              }}
              placeholder="0x1000 or 4096"
              className="bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-gray-200 font-mono text-sm w-48 outline-none focus:border-blue-500"
              autoFocus
            />
            <div className="text-gray-500 text-xs mt-2">
              Hex: 0x1000 or 1000h | Dec: 4096
            </div>
            <div className="flex gap-2 mt-3">
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm"
              >
                Go
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowGoTo(false)
                  containerRef.current?.focus()
                }}
                className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
})

export default HexViewer
