import { useMemo, useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'webols-mapfinder-results'

// Calculate local entropy for a window of bytes
function calculateEntropy(data, offset, length) {
  if (offset + length > data.length) return 1

  const counts = new Array(256).fill(0)
  for (let i = 0; i < length; i++) {
    counts[data[offset + i]]++
  }

  let entropy = 0
  for (let i = 0; i < 256; i++) {
    if (counts[i] > 0) {
      const p = counts[i] / length
      entropy -= p * Math.log2(p)
    }
  }
  return entropy / 8 // Normalize to 0-1
}

// Calculate smoothness score (how gradually values change)
function calculateSmoothness(data, offset, length, valueSize, isLE) {
  if (offset + length > data.length) return 0

  const readValue = (off) => {
    let value = 0
    for (let i = 0; i < valueSize; i++) {
      if (isLE) {
        value |= data[off + i] << (i * 8)
      } else {
        value |= data[off + i] << ((valueSize - 1 - i) * 8)
      }
    }
    return value
  }

  const numValues = Math.floor(length / valueSize)
  if (numValues < 2) return 0

  let totalDiff = 0
  let maxDiff = 0
  const values = []

  for (let i = 0; i < numValues; i++) {
    values.push(readValue(offset + i * valueSize))
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  if (range === 0) return 0

  for (let i = 1; i < numValues; i++) {
    const diff = Math.abs(values[i] - values[i - 1])
    totalDiff += diff
    maxDiff = Math.max(maxDiff, diff)
  }

  const avgDiff = totalDiff / (numValues - 1)
  const smoothness = 1 - (avgDiff / range)

  return Math.max(0, smoothness)
}

// Detect period/column width using autocorrelation
function detectPeriod(data, offset, length, valueSize, isLE, minPeriod = 4, maxPeriod = 32) {
  const readValue = (off) => {
    if (off + valueSize > data.length) return 0
    let value = 0
    for (let i = 0; i < valueSize; i++) {
      if (isLE) {
        value |= data[off + i] << (i * 8)
      } else {
        value |= data[off + i] << ((valueSize - 1 - i) * 8)
      }
    }
    return value
  }

  const numValues = Math.floor(length / valueSize)
  if (numValues < minPeriod * 2) return null

  const values = []
  for (let i = 0; i < numValues; i++) {
    values.push(readValue(offset + i * valueSize))
  }

  // Calculate mean
  const mean = values.reduce((a, b) => a + b, 0) / values.length

  // Try different periods and calculate correlation
  let bestPeriod = null
  let bestScore = -1

  for (let period = minPeriod; period <= Math.min(maxPeriod, Math.floor(numValues / 2)); period++) {
    let correlation = 0
    let count = 0

    // Compare values at distance 'period' apart
    for (let i = 0; i < numValues - period; i++) {
      const v1 = values[i] - mean
      const v2 = values[i + period] - mean
      correlation += v1 * v2
      count++
    }

    if (count > 0) {
      correlation /= count

      // Also check for row-like structure (similar differences within rows)
      let rowScore = 0
      const numRows = Math.floor(numValues / period)

      if (numRows >= 2) {
        for (let col = 0; col < period - 1; col++) {
          let colDiffs = []
          for (let row = 0; row < numRows; row++) {
            const idx = row * period + col
            if (idx + 1 < numValues) {
              colDiffs.push(values[idx + 1] - values[idx])
            }
          }
          if (colDiffs.length >= 2) {
            const avgDiff = colDiffs.reduce((a, b) => a + b, 0) / colDiffs.length
            const variance = colDiffs.reduce((a, b) => a + Math.pow(b - avgDiff, 2), 0) / colDiffs.length
            rowScore += 1 / (1 + Math.sqrt(variance))
          }
        }
        rowScore /= (period - 1)
      }

      const combinedScore = correlation * 0.5 + rowScore * 0.5

      if (combinedScore > bestScore) {
        bestScore = combinedScore
        bestPeriod = period
      }
    }
  }

  return bestPeriod && bestScore > 0.1 ? { period: bestPeriod, score: bestScore } : null
}

// Find region boundaries where structure changes
function findRegionBoundaries(data, startOffset, valueSize, isLE, minSize = 64) {
  const windowSize = 32 * valueSize
  const stepSize = 8 * valueSize

  let regionStart = startOffset
  let regionEnd = startOffset
  let inRegion = false
  const entropyThreshold = 0.7
  const smoothnessThreshold = 0.2

  for (let offset = startOffset; offset < data.length - windowSize; offset += stepSize) {
    const entropy = calculateEntropy(data, offset, windowSize)
    const smoothness = calculateSmoothness(data, offset, windowSize, valueSize, isLE)

    const isStructured = entropy < entropyThreshold && smoothness > smoothnessThreshold

    if (isStructured && !inRegion) {
      regionStart = offset
      inRegion = true
    } else if (!isStructured && inRegion) {
      regionEnd = offset
      if (regionEnd - regionStart >= minSize) {
        return { start: regionStart, end: regionEnd }
      }
      inRegion = false
    }
  }

  if (inRegion && data.length - regionStart >= minSize) {
    return { start: regionStart, end: data.length }
  }

  return null
}

// Main analysis function for a candidate region
function analyzeCandidate(data, offset, rows, cols, dataType, isLE) {
  const size = dataType.includes('8') ? 1 : dataType.includes('16') ? 2 : 4
  const signed = dataType.startsWith('i')
  const totalBytes = rows * cols * size

  if (offset + totalBytes > data.length) return null

  const readValue = (off) => {
    if (off + size > data.length) return null
    let value = 0
    for (let i = 0; i < size; i++) {
      if (isLE) {
        value |= data[off + i] << (i * 8)
      } else {
        value |= data[off + i] << ((size - 1 - i) * 8)
      }
    }
    if (signed) {
      const signBit = 1 << (size * 8 - 1)
      if (value >= signBit) {
        value = value - (1 << (size * 8))
      }
    }
    return value
  }

  // Read all values
  const values = []
  let min = Infinity, max = -Infinity
  let sum = 0

  for (let r = 0; r < rows; r++) {
    const row = []
    for (let c = 0; c < cols; c++) {
      const val = readValue(offset + (r * cols + c) * size)
      if (val === null) return null
      row.push(val)
      min = Math.min(min, val)
      max = Math.max(max, val)
      sum += val
    }
    values.push(row)
  }

  const count = rows * cols
  const mean = sum / count
  const range = max - min

  if (range === 0) return null

  // Gradient analysis
  let rowGradientSum = 0, colGradientSum = 0
  let gradientCount = 0

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      rowGradientSum += Math.abs(values[r][c + 1] - values[r][c])
      gradientCount++
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      colGradientSum += Math.abs(values[r + 1][c] - values[r][c])
    }
  }

  const avgGradient = (rowGradientSum + colGradientSum) / (gradientCount * 2)
  const gradientScore = 1 - Math.min(1, avgGradient / range)

  // Row/column correlation
  let rowCorr = 0, colCorr = 0

  if (rows >= 2 && cols >= 2) {
    for (let r = 0; r < rows - 1; r++) {
      let corrSum = 0
      for (let c = 0; c < cols; c++) {
        corrSum += (values[r][c] - mean) * (values[r + 1][c] - mean)
      }
      rowCorr += corrSum / cols
    }
    rowCorr /= (rows - 1)

    for (let c = 0; c < cols - 1; c++) {
      let corrSum = 0
      for (let r = 0; r < rows; r++) {
        corrSum += (values[r][c] - mean) * (values[r][c + 1] - mean)
      }
      colCorr += corrSum / rows
    }
    colCorr /= (cols - 1)
  }

  // Normalize correlations
  const variance = values.flat().reduce((a, v) => a + Math.pow(v - mean, 2), 0) / count
  if (variance > 0) {
    rowCorr /= variance
    colCorr /= variance
  }

  // Score calculation
  let score = 0

  score += gradientScore * 35
  score += Math.max(0, Math.min(1, (rowCorr + colCorr) / 2)) * 25

  // Size bonus
  if (rows >= 4 && cols >= 4) score += 10
  if (rows >= 8 && cols >= 8) score += 10
  if (rows * cols >= 64) score += 10

  // Penalize very small or very large tables
  if (rows < 3 || cols < 3) score -= 20
  if (rows > 64 || cols > 64) score -= 10

  return {
    offset,
    rows,
    cols,
    dataType,
    score: Math.max(0, Math.min(100, score)),
    stats: {
      min,
      max,
      mean: mean.toFixed(1),
      range,
      gradientScore: gradientScore.toFixed(2),
      rowCorr: rowCorr.toFixed(2),
      colCorr: colCorr.toFixed(2),
    }
  }
}

function MapFinder({ dataA, dataB, dataC, endianness, onViewAsTable, onSaveAsTable }) {
  const [searchIn, setSearchIn] = useState('A')
  const [isSearching, setIsSearching] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState([])
  const [minScore, setMinScore] = useState(40)
  const [dataTypes, setDataTypes] = useState(['u8', 'u16', 'u32', 'i8', 'i16', 'i32'])

  const activeData = searchIn === 'C' ? dataC : searchIn === 'B' ? dataB : dataA
  const isLE = endianness === 'little'

  // Load saved results from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        if (data.results && Array.isArray(data.results)) {
          setResults(data.results)
        }
        if (data.searchIn) {
          setSearchIn(data.searchIn)
        }
      }
    } catch (e) {
      console.error('Failed to load MapFinder results:', e)
    }
  }, [])

  // Save results to localStorage when they change
  useEffect(() => {
    if (results.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          results,
          searchIn,
          savedAt: new Date().toISOString(),
        }))
      } catch (e) {
        console.error('Failed to save MapFinder results:', e)
      }
    }
  }, [results, searchIn])

  const runSearch = useCallback(async () => {
    if (!activeData) return

    setIsSearching(true)
    setResults([])
    setProgress(0)

    const candidates = []
    const step = 16 // Scan every N bytes
    const windowSize = 256 // Analysis window

    let processedBytes = 0
    const totalBytes = activeData.length

    const processChunk = (startOffset) => {
      const chunkEnd = Math.min(startOffset + 4096, activeData.length - windowSize)

      for (let offset = startOffset; offset < chunkEnd; offset += step) {
        // Quick entropy check to find interesting regions
        const entropy = calculateEntropy(activeData, offset, Math.min(windowSize, activeData.length - offset))

        // Skip high entropy (random/compressed) or very low entropy (empty/uniform)
        if (entropy < 0.1 || entropy > 0.85) continue

        // Try each data type
        for (const dataType of dataTypes) {
          const valueSize = dataType.includes('8') ? 1 : dataType.includes('16') ? 2 : 4
          const maxBytes = Math.min(2048, activeData.length - offset)

          // Detect period (column width)
          const periodResult = detectPeriod(activeData, offset, maxBytes, valueSize, isLE, 4, 40)

          if (periodResult) {
            const cols = periodResult.period

            // Try to find optimal row count
            for (let rows = 4; rows <= 40; rows++) {
              const totalSize = rows * cols * valueSize
              if (offset + totalSize > activeData.length) break

              const result = analyzeCandidate(activeData, offset, rows, cols, dataType, isLE)

              if (result && result.score >= minScore) {
                // Check for overlap with better existing candidates
                const dominated = candidates.some(c => {
                  const cSize = c.rows * c.cols * (c.dataType.includes('16') ? 2 : c.dataType.includes('32') ? 4 : 1)
                  const rSize = result.rows * result.cols * valueSize
                  const cEnd = c.offset + cSize
                  const rEnd = result.offset + rSize

                  // If overlapping and existing is better, skip
                  return !(rEnd <= c.offset || result.offset >= cEnd) && c.score >= result.score
                })

                if (!dominated) {
                  // Remove lower-scoring overlapping candidates
                  for (let i = candidates.length - 1; i >= 0; i--) {
                    const c = candidates[i]
                    const cSize = c.rows * c.cols * (c.dataType.includes('16') ? 2 : c.dataType.includes('32') ? 4 : 1)
                    const rSize = result.rows * result.cols * valueSize
                    const cEnd = c.offset + cSize
                    const rEnd = result.offset + rSize

                    if (!(rEnd <= c.offset || result.offset >= cEnd) && result.score > c.score) {
                      candidates.splice(i, 1)
                    }
                  }
                  candidates.push(result)
                }
              }
            }
          }

          // Also try common aspect ratios without period detection
          const aspectRatios = [[1, 1], [1, 2], [2, 1], [1, 4], [4, 1]]
          for (const [rowRatio, colRatio] of aspectRatios) {
            for (let baseSize = 4; baseSize <= 20; baseSize++) {
              const rows = baseSize * rowRatio
              const cols = baseSize * colRatio
              if (rows > 40 || cols > 40) continue

              const totalSize = rows * cols * valueSize
              if (offset + totalSize > activeData.length) continue

              const result = analyzeCandidate(activeData, offset, rows, cols, dataType, isLE)

              if (result && result.score >= minScore) {
                const dominated = candidates.some(c => {
                  const cSize = c.rows * c.cols * (c.dataType.includes('16') ? 2 : c.dataType.includes('32') ? 4 : 1)
                  const rSize = result.rows * result.cols * valueSize
                  const cEnd = c.offset + cSize
                  const rEnd = result.offset + rSize
                  return !(rEnd <= c.offset || result.offset >= cEnd) && c.score >= result.score
                })

                if (!dominated) {
                  candidates.push(result)
                }
              }
            }
          }
        }

        processedBytes = offset
      }

      setProgress(Math.round((processedBytes / totalBytes) * 100))

      if (chunkEnd < activeData.length - windowSize) {
        setTimeout(() => processChunk(chunkEnd), 0)
      } else {
        // Final processing
        candidates.sort((a, b) => b.score - a.score)

        // Remove overlapping lower-scored results
        const filtered = []
        for (const c of candidates) {
          const cSize = c.rows * c.cols * (c.dataType.includes('16') ? 2 : c.dataType.includes('32') ? 4 : 1)
          const cEnd = c.offset + cSize

          const overlaps = filtered.some(f => {
            const fSize = f.rows * f.cols * (f.dataType.includes('16') ? 2 : f.dataType.includes('32') ? 4 : 1)
            const fEnd = f.offset + fSize
            return !(cEnd <= f.offset || c.offset >= fEnd)
          })

          if (!overlaps) {
            filtered.push(c)
          }
        }

        setResults(filtered.slice(0, 100))
        setIsSearching(false)
      }
    }

    setTimeout(() => processChunk(0), 0)
  }, [activeData, dataTypes, minScore, isLE])

  const formatOffset = (offset) => {
    return '0x' + offset.toString(16).toUpperCase().padStart(6, '0')
  }

  const hasData = dataA || dataB || dataC

  if (!hasData) {
    return (
      <div className="p-3 text-gray-500 text-sm text-center">
        Load a file to find maps
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
                : 'bg-green-600 hover:bg-green-500 text-white'
            }`}
          >
            {isSearching ? `${progress}%` : 'Find Maps'}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Min:</span>
          <input
            type="range"
            min="20"
            max="70"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            disabled={isSearching}
            className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
          />
          <span className="text-xs text-gray-400 w-8">{minScore}</span>
        </div>

        <div className="flex flex-wrap gap-1">
          {['u8', 'u16', 'u32', 'i8', 'i16', 'i32'].map(dt => (
            <button
              key={dt}
              onClick={() => setDataTypes(prev =>
                prev.includes(dt) ? prev.filter(x => x !== dt) : [...prev, dt]
              )}
              disabled={isSearching}
              className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
                dataTypes.includes(dt)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400'
              }`}
            >
              {dt}
            </button>
          ))}
        </div>

        {results.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-green-400">
              Found {results.length} map{results.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => {
                setResults([])
                localStorage.removeItem(STORAGE_KEY)
              }}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
              title="Clear results"
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
                className="h-full bg-green-500 transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 text-center mt-2">
              Analyzing patterns...
            </div>
          </div>
        )}

        {!isSearching && results.length === 0 && (
          <div className="p-3 text-gray-500 text-sm text-center">
            Click "Find Maps" to search
          </div>
        )}

        {!isSearching && results.length > 0 && (
          <div className="divide-y divide-gray-700/50">
            {results.map((result) => (
              <div
                key={`${result.offset}-${result.rows}-${result.cols}-${result.dataType}`}
                className="px-2 py-2 hover:bg-gray-700 group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-gray-200 text-xs font-mono">
                    {formatOffset(result.offset)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${
                      result.score >= 60 ? 'text-green-400' :
                      result.score >= 45 ? 'text-yellow-400' : 'text-gray-400'
                    }`}>
                      {result.score.toFixed(0)}%
                    </span>
                    <button
                      onClick={() => onViewAsTable({
                        start: result.offset,
                        rows: result.rows,
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
                        rows: result.rows,
                        cols: result.cols,
                        dataType: result.dataType,
                        name: `Map_${formatOffset(result.offset)}`,
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
                  <span>{result.rows}×{result.cols}</span>
                  <span className="text-gray-600">|</span>
                  <span className="font-mono">{result.dataType.toUpperCase()}</span>
                  <span className="text-gray-600">|</span>
                  <span>{result.stats.min}–{result.stats.max}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-600">
                  <span title="Gradient smoothness">G:{result.stats.gradientScore}</span>
                  <span title="Row correlation">R:{result.stats.rowCorr}</span>
                  <span title="Column correlation">C:{result.stats.colCorr}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default MapFinder
