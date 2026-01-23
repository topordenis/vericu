import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

const BYTES_PER_ROW = 16
const VISIBLE_ROWS = 32

const VIEW_MODES = {
  hex: { label: 'Hex', size: 1, perRow: 16, width: 'w-7', signed: false },
  u8: { label: 'U8', size: 1, perRow: 16, width: 'w-10', signed: false },
  i8: { label: 'I8', size: 1, perRow: 16, width: 'w-10', signed: true },
  u16: { label: 'U16', size: 2, perRow: 8, width: 'w-14', signed: false },
  i16: { label: 'I16', size: 2, perRow: 8, width: 'w-14', signed: true },
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
  endianness = 'little' // 'little' or 'big'
}, ref) {
  const containerRef = useRef(null)
  const [cursorPos, setCursorPos] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [showGoTo, setShowGoTo] = useState(false)
  const [goToValue, setGoToValue] = useState('')
  const goToInputRef = useRef(null)

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
      default:
        return
    }

    setCursorPos(newPos)
    ensureCursorVisible(newPos)
  }, [cursorPos, maxLength, ensureCursorVisible, bytesPerRow, itemSize, openGoToDialog])

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const delta = Math.sign(e.deltaY) * 3
    setScrollOffset(prev => Math.max(0, Math.min(totalRows - VISIBLE_ROWS, prev + delta)))
  }, [totalRows])

  const handleByteClick = useCallback((index) => {
    setCursorPos(index)
    containerRef.current?.focus()
  }, [])

  useEffect(() => {
    containerRef.current?.focus()
  }, [fileA, fileB])

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

  const rows = []
  for (let i = 0; i < VISIBLE_ROWS && (scrollOffset + i) * bytesPerRow < maxLength; i++) {
    const rowStart = (scrollOffset + i) * bytesPerRow
    const rowItems = []
    for (let j = 0; j < itemsPerRow; j++) {
      const byteIndex = rowStart + j * itemSize
      if (byteIndex < maxLength) {
        if (isDiffMode) {
          const { display, diff } = formatDiffValue(byteIndex)
          rowItems.push({ index: byteIndex, value: display, diff })
        } else {
          rowItems.push({ index: byteIndex, value: formatValue(activeData, byteIndex), diff: null })
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
      onWheel={handleWheel}
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
                  let className = `${mode.width} text-center cursor-pointer `

                  if (isCurrentPos) {
                    className += 'bg-blue-600 text-white'
                  } else if (isDiffMode) {
                    className += getDiffBgColor(item.diff) + ' ' + getDiffColor(item.diff) + ' hover:bg-gray-700'
                  } else {
                    className += 'text-green-400 hover:bg-gray-700'
                  }

                  if (j === Math.floor(itemsPerRow / 2) - 1) {
                    className += ' mr-2'
                  }

                  return (
                    <span
                      key={item.index}
                      onClick={() => handleByteClick(item.index)}
                      className={className}
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
                  const isCurrentPos = isSelected(byte.index)
                  let className = 'w-2.5 text-center cursor-pointer '

                  if (isCurrentPos) {
                    className += 'bg-blue-600 text-white'
                  } else if (isDiffMode && byte.diff !== null && byte.diff !== 0) {
                    className += byte.diff > 0 ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/30'
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
