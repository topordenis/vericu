import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'webols-mapsensor-results'

// Common MAP pressure ranges in mmbar (after formula conversion)
const PRESSURE_RANGES = {
  low: { min: 200, max: 600, label: 'Low (200-600 mmbar)' },
  normal: { min: 400, max: 1200, label: 'Normal (400-1200 mmbar)' },
  high: { min: 800, max: 2000, label: 'High (800-2000 mmbar)' },
  boost: { min: 1000, max: 3000, label: 'Boost (1000-3000 mmbar)' },
}

// Data types to search
const DATA_TYPES = ['u8', 'u16']

function MapSensorFinder({ dataA, dataB, dataC, endianness, onGoToOffset, onViewAsTable, onSaveAsTable }) {
  const [searchIn, setSearchIn] = useState('A')
  const [isSearching, setIsSearching] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState([])
  const [pressureRange, setPressureRange] = useState('normal')
  const [numColumns, setNumColumns] = useState('17')
  const [formula, setFormula] = useState('(x-103) * 3.7')
  const [dataType, setDataType] = useState('u16')

  const activeData = searchIn === 'C' ? dataC : searchIn === 'B' ? dataB : dataA

  // Load saved results
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        if (data.results) setResults(data.results)
        if (data.searchIn) setSearchIn(data.searchIn)
      }
    } catch (e) {
      console.error('Failed to load MAP results:', e)
    }
  }, [])

  // Save results
  useEffect(() => {
    if (results.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          results,
          searchIn,
          savedAt: new Date().toISOString(),
        }))
      } catch (e) {
        console.error('Failed to save MAP results:', e)
      }
    }
  }, [results, searchIn])

  // Parse and apply formula
  const applyFormula = useCallback((rawValue, formulaStr) => {
    try {
      const x = rawValue
      const result = new Function('x', `return ${formulaStr}`)(x)
      return typeof result === 'number' && !isNaN(result) ? result : null
    } catch {
      return null
    }
  }, [])

  // Read value with specified data type and endianness
  const readValue = useCallback((data, offset, type, useLE) => {
    const isSigned = type.startsWith('i')
    const size = type.includes('8') ? 1 : 2

    if (offset + size > data.length) return null

    let value = 0
    for (let i = 0; i < size; i++) {
      if (useLE) {
        value |= data[offset + i] << (i * 8)
      } else {
        value |= data[offset + i] << ((size - 1 - i) * 8)
      }
    }

    if (isSigned) {
      const signBit = 1 << (size * 8 - 1)
      if (value >= signBit) {
        value = value - (1 << (size * 8))
      }
    }

    return value
  }, [])

  const runSearch = useCallback(() => {
    if (!activeData) return

    setIsSearching(true)
    setResults([])
    setProgress(0)

    const candidates = []
    const cols = parseInt(numColumns) || 17
    const range = PRESSURE_RANGES[pressureRange]
    const size = dataType.includes('8') ? 1 : 2

    // Search both endiannesses
    const endiannesses = [
      { name: 'LE', le: true },
      { name: 'BE', le: false }
    ]

    // Process in chunks
    const processChunk = (startOffset) => {
      const chunkEnd = Math.min(startOffset + 8192, activeData.length - cols * size)

      for (let offset = startOffset; offset < chunkEnd; offset++) {
        // Try both endiannesses
        for (const { name: endName, le: useLE } of endiannesses) {
          // Try to read a row of values
          const rowValues = []
          let allValid = true

          for (let c = 0; c < cols; c++) {
            const val = readValue(activeData, offset + c * size, dataType, useLE)
            if (val === null) {
              allValid = false
              break
            }
            rowValues.push(val)
          }

          if (!allValid || rowValues.length !== cols) continue

          // Check if this looks like a MAP curve - must be smooth and consistently increasing
          const firstVal = rowValues[0]
          const lastVal = rowValues[rowValues.length - 1]

          // Overall must increase
          if (lastVal <= firstVal) continue

          // Analyze the pattern
          let increasingCount = 0
          let decreasingCount = 0
          let largeDecreases = 0

          for (let i = 1; i < rowValues.length; i++) {
            const diff = rowValues[i] - rowValues[i - 1]
            if (diff > 0) increasingCount++
            else if (diff < 0) {
              decreasingCount++
              // Large decrease (> 20% of previous value) is bad
              if (Math.abs(diff) > rowValues[i - 1] * 0.2) {
                largeDecreases++
              }
            }
          }

          // Strict requirements:
          // 1. At least 70% of steps should increase
          const increaseRatio = increasingCount / (rowValues.length - 1)
          if (increaseRatio < 0.7) continue

          // 2. No large decreases
          if (largeDecreases > 0) continue

          // 3. Decreases < 20% of steps
          if (decreasingCount / (rowValues.length - 1) > 0.2) continue

          // 4. First value should be the lowest
          if (rowValues[0] > Math.min(...rowValues.slice(1))) continue

          // Apply formula
          const convertedValues = rowValues.map(v => applyFormula(v, formula))
          if (convertedValues.some(v => v === null)) continue

          const minConverted = Math.min(...convertedValues)
          const maxConverted = Math.max(...convertedValues)

          // Must have values in target range
          const inRangeCount = convertedValues.filter(v =>
            v >= range.min && v <= range.max
          ).length

          if (inRangeCount < cols * 0.3) continue

          // Score this candidate
          let score = 0
          const reasons = []

          if (increaseRatio >= 0.9) {
            score += 30
            reasons.push('smooth')
          } else if (increaseRatio >= 0.8) {
            score += 25
          } else {
            score += 20
          }

          if (decreasingCount === 0) {
            score += 15
            reasons.push('strict-inc')
          }

          const overallIncrease = lastVal - firstVal
          score += Math.min(15, overallIncrease / 20)

          const rangeRatio = inRangeCount / cols
          score += rangeRatio * 30
          if (rangeRatio > 0.7) reasons.push('in-range')

          // Check smooth progression in converted values
          let smoothCount = 0
          for (let i = 1; i < convertedValues.length; i++) {
            const diff = Math.abs(convertedValues[i] - convertedValues[i - 1])
            if (diff >= 20 && diff <= 300) smoothCount++
          }
          const smoothRatio = smoothCount / (convertedValues.length - 1)
          score += smoothRatio * 25

          if (minConverted >= 0 && minConverted <= 600) score += 10
          if (maxConverted >= 800 && maxConverted <= 3500) score += 10

          candidates.push({
            offset,
            rawValues: rowValues,
            convertedValues,
            minConverted: Math.round(minConverted),
            maxConverted: Math.round(maxConverted),
            score: Math.round(score),
            reasons: reasons.join(', '),
            cols,
            dataType,
            formula,
            endianness: endName,
          })
        }
      }

      setProgress(Math.round((chunkEnd / (activeData.length - cols * size)) * 100))

      if (chunkEnd < activeData.length - cols * size) {
        setTimeout(() => processChunk(chunkEnd), 0)
      } else {
        // Sort and deduplicate
        candidates.sort((a, b) => b.score - a.score)

        const filtered = []
        for (const c of candidates) {
          const isDuplicate = filtered.some(f =>
            Math.abs(f.offset - c.offset) < cols * size && f.score >= c.score
          )
          if (!isDuplicate) {
            filtered.push(c)
          }
        }

        setResults(filtered.slice(0, 50))
        setIsSearching(false)
      }
    }

    setTimeout(() => processChunk(0), 0)
  }, [activeData, numColumns, formula, dataType, pressureRange, readValue, applyFormula])

  const formatOffset = (offset) => {
    return '0x' + offset.toString(16).toUpperCase().padStart(6, '0')
  }

  const hasData = dataA || dataB || dataC

  if (!hasData) {
    return (
      <div className="p-3 text-gray-500 text-sm text-center">
        Load a file to search
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="px-2 py-2 border-b border-gray-700 space-y-2">
        <div className="flex items-center gap-2">
          <select
            value={searchIn}
            onChange={(e) => setSearchIn(e.target.value)}
            className="flex-1 bg-gray-700 text-gray-300 text-xs rounded px-1 py-1 outline-none"
            disabled={isSearching}
          >
            {dataA && <option value="A">File A</option>}
            {dataB && <option value="B">File B</option>}
            {dataC && <option value="C">File C</option>}
          </select>
          <button
            onClick={runSearch}
            disabled={isSearching || !activeData}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              isSearching
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white'
            }`}
          >
            {isSearching ? `${progress}%` : 'Find MAP'}
          </button>
        </div>

        {/* Columns input */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Cols:</span>
          <input
            type="number"
            min="2"
            max="64"
            value={numColumns}
            onChange={(e) => setNumColumns(e.target.value)}
            className="flex-1 bg-gray-700 text-gray-300 text-xs rounded px-2 py-1 outline-none"
            disabled={isSearching}
          />
        </div>

        {/* Data type */}
        <div className="flex gap-1">
          {DATA_TYPES.map(dt => (
            <button
              key={dt}
              onClick={() => setDataType(dt)}
              className={`flex-1 px-2 py-1 rounded text-xs font-mono transition-colors ${
                dataType === dt
                  ? 'bg-cyan-600 text-white'
                  : 'bg-gray-700 text-gray-400'
              }`}
              disabled={isSearching}
            >
              {dt.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Formula input */}
        <div>
          <input
            type="text"
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            placeholder="(x-103) * 3.7"
            className="w-full bg-gray-700 text-gray-300 text-xs rounded px-2 py-1 font-mono outline-none focus:border-cyan-500"
            disabled={isSearching}
          />
          <div className="text-xs text-gray-600 mt-1">Result: mmbar</div>
        </div>

        {/* Pressure range */}
        <select
          value={pressureRange}
          onChange={(e) => setPressureRange(e.target.value)}
          className="w-full bg-gray-700 text-gray-300 text-xs rounded px-1 py-1 outline-none"
          disabled={isSearching}
        >
          {Object.entries(PRESSURE_RANGES).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        {results.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-cyan-400">
              Found {results.length} candidate{results.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => {
                setResults([])
                localStorage.removeItem(STORAGE_KEY)
              }}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {isSearching && (
          <div className="p-4">
            <div className="h-2 bg-gray-700 rounded overflow-hidden">
              <div
                className="h-full bg-cyan-500 transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 text-center mt-2">
              Searching for MAP sensor tables...
            </div>
          </div>
        )}

        {!isSearching && results.length === 0 && (
          <div className="p-3 text-gray-500 text-sm text-center">
            Click "Find MAP" to search
          </div>
        )}

        {!isSearching && results.length > 0 && (
          <div className="divide-y divide-gray-700/50">
            {results.map((result, idx) => (
              <div
                key={`${result.offset}-${result.dataType}-${result.endianness}`}
                className="px-2 py-2 hover:bg-gray-700 group"
              >
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => onGoToOffset(result.offset)}
                    className="text-blue-400 hover:text-blue-300 text-xs font-mono hover:underline"
                    title="Go to offset"
                  >
                    {formatOffset(result.offset)}
                  </button>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${
                      result.score >= 60 ? 'text-green-400' :
                      result.score >= 40 ? 'text-yellow-400' : 'text-gray-400'
                    }`}>
                      {result.score}%
                    </span>
                    <button
                      onClick={() => onViewAsTable({
                        start: result.offset,
                        rows: 1,
                        cols: result.cols,
                        dataType: result.dataType,
                      })}
                      className="text-gray-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Preview as table"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onSaveAsTable({
                        offset: result.offset,
                        rows: 1,
                        cols: result.cols,
                        dataType: result.dataType,
                        name: `MAP_${formatOffset(result.offset)}`,
                      })}
                      className="text-gray-500 hover:text-green-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Save as table"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                  <span>{result.cols} cols</span>
                  <span className="font-mono">{result.dataType.toUpperCase()}</span>
                  <span className="text-purple-400 font-mono">{result.endianness}</span>
                  <span className="text-gray-600">|</span>
                  <span className="text-cyan-400">{result.minConverted}-{result.maxConverted} mmbar</span>
                </div>

                {result.reasons && (
                  <div className="mt-0.5 text-xs text-blue-400">
                    {result.reasons}
                  </div>
                )}

                {/* Show sample values */}
                <div className="mt-1 text-xs text-gray-600 font-mono flex gap-1 overflow-x-auto">
                  {result.convertedValues.slice(0, 8).map((v, i) => (
                    <span key={i} className="whitespace-nowrap">
                      {Math.round(v)}
                    </span>
                  ))}
                  {result.convertedValues.length > 8 && <span>...</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-2 py-2 border-t border-gray-700 text-xs text-gray-600">
        <div>Looking for 1×N tables with smoothly increasing pressure values (both LE/BE)</div>
      </div>
    </div>
  )
}

export default MapSensorFinder
