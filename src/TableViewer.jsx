import { useMemo, useState } from 'react'

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

function TableViewer({ table, dataA, dataB, dataC, onClose }) {
  const loadedCount = [dataA, dataB, dataC].filter(Boolean).length
  const [viewMode, setViewMode] = useState(loadedCount >= 2 ? 'diff' : 'A')
  const [diffPair, setDiffPair] = useState('A-B') // 'A-B', 'A-C', 'B-C'
  const [endianness, setEndianness] = useState('little') // 'little' or 'big'
  const [displayDataType, setDisplayDataType] = useState(table.dataType) // Allow changing interpretation

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

  // Calculate effective dimensions based on display data type
  const effectiveDimensions = useMemo(() => {
    const originalSize = TYPE_SIZES[table.dataType]
    const newSize = TYPE_SIZES[displayDataType]
    const totalBytes = table.rows * table.cols * originalSize

    // Keep same column count, adjust rows
    const newCols = table.cols
    const newRows = Math.floor(totalBytes / (newCols * newSize))

    return { rows: Math.max(1, newRows), cols: newCols }
  }, [table.rows, table.cols, table.dataType, displayDataType])

  const { valuesA, valuesB, valuesC, diffs, statsA, statsB, statsC, statsDiff } = useMemo(() => {
    const size = TYPE_SIZES[displayDataType]
    const signed = TYPE_SIGNED[displayDataType]
    const isLE = endianness === 'little'
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
        const offset = table.offset + (r * cols + c) * size

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
  }, [table.offset, effectiveDimensions, displayDataType, dataA, dataB, dataC, diffPair, endianness])

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

  const currentValues = viewMode === 'A' ? valuesA : viewMode === 'B' ? valuesB : viewMode === 'C' ? valuesC : diffs
  const currentStats = viewMode === 'A' ? statsA : viewMode === 'B' ? statsB : viewMode === 'C' ? statsC : statsDiff
  const isDiffMode = viewMode === 'diff'

  return (
    <div className="flex flex-col h-full bg-gray-900 flex-1">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-gray-200 font-semibold">{table.name}</span>
          <span className="text-gray-500 text-sm">
            {effectiveDimensions.rows}×{effectiveDimensions.cols} | 0x{table.offset.toString(16).toUpperCase()}
          </span>
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
                    {rowIndex}
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

                    let tooltip = `[${rowIndex}, ${colIndex}]\n`
                    tooltip += `Offset: 0x${(table.offset + (rowIndex * effectiveDimensions.cols + colIndex) * TYPE_SIZES[displayDataType]).toString(16).toUpperCase()}\n`
                    if (dataA) tooltip += `File A: ${valA}\n`
                    if (dataB) tooltip += `File B: ${valB}\n`
                    if (dataC) tooltip += `File C: ${valC}\n`
                    if (loadedCount >= 2 && diff !== null) tooltip += `Diff (${diffPair}): ${diff > 0 ? '+' : ''}${diff}`

                    const displayValue = isDiffMode
                      ? (value === null ? '??' : value === 0 ? '0' : (value > 0 ? `+${value}` : value))
                      : (value !== null ? value : '??')

                    return (
                      <td
                        key={colIndex}
                        className={`px-2 py-1 text-center font-mono text-sm border border-gray-700/50 min-w-[3rem] ${textColor}`}
                        style={{ backgroundColor: typeof bgColor === 'string' && bgColor.startsWith('rgb') ? bgColor : undefined }}
                        title={tooltip}
                      >
                        {displayValue}
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
                    {colIndex}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

export default TableViewer
