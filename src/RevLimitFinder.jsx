import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'webols-revlimit-results'

// Common RPM ranges and scaling factors
const RPM_RANGES = {
  low: { min: 3000, max: 5000, label: 'Low (3000-5000)' },
  medium: { min: 5000, max: 7000, label: 'Medium (5000-7000)' },
  high: { min: 7000, max: 9000, label: 'High (7000-9000)' },
  veryHigh: { min: 9000, max: 12000, label: 'Very High (9000-12000)' },
}

const SCALING_FACTORS = [
  { factor: 1, label: 'Direct RPM' },
  { factor: 0.25, label: 'RPM × 0.25' },
  { factor: 0.5, label: 'RPM × 0.5' },
  { factor: 4, label: 'RPM / 4' },
  { factor: 8, label: 'RPM / 8' },
  { factor: 10, label: 'RPM / 10' },
  { factor: 0.125, label: 'RPM × 0.125' },
]

// Hysteresis typically 100-500 RPM below main limit
const HYSTERESIS_RANGE = { min: 100, max: 500 }

function RevLimitFinder({ dataA, dataB, dataC, endianness, onGoToOffset }) {
  const [searchIn, setSearchIn] = useState('A')
  const [isSearching, setIsSearching] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState([])
  const [rpmRange, setRpmRange] = useState('medium')
  const [customRpm, setCustomRpm] = useState('')
  const [searchMode, setSearchMode] = useState('auto') // 'auto', 'exact', 'range'

  const activeData = searchIn === 'C' ? dataC : searchIn === 'B' ? dataB : dataA
  const isLE = endianness === 'little'

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
      console.error('Failed to load RevLimit results:', e)
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
        console.error('Failed to save RevLimit results:', e)
      }
    }
  }, [results, searchIn])

  const readU16 = useCallback((data, offset) => {
    if (offset + 2 > data.length) return null
    if (isLE) {
      return data[offset] | (data[offset + 1] << 8)
    } else {
      return (data[offset] << 8) | data[offset + 1]
    }
  }, [isLE])

  const readU8 = useCallback((data, offset) => {
    if (offset >= data.length) return null
    return data[offset]
  }, [])

  const runSearch = useCallback(() => {
    if (!activeData) return

    setIsSearching(true)
    setResults([])
    setProgress(0)

    const candidates = []
    const range = RPM_RANGES[rpmRange]
    const exactRpm = customRpm ? parseInt(customRpm, 10) : null

    // Build value occurrence map for finding repeated values
    const valueOccurrences = new Map() // value -> [offsets]

    const processChunk = (startOffset) => {
      const chunkEnd = Math.min(startOffset + 8192, activeData.length - 2)

      for (let offset = startOffset; offset < chunkEnd; offset += 2) {
        const value16 = readU16(activeData, offset)
        if (value16 === null) continue

        // Track occurrences
        if (!valueOccurrences.has(value16)) {
          valueOccurrences.set(value16, [])
        }
        valueOccurrences.get(value16).push(offset)

        // Check each scaling factor
        for (const { factor, label } of SCALING_FACTORS) {
          const rpm = value16 * factor

          let isCandidate = false
          let matchType = ''

          if (searchMode === 'exact' && exactRpm) {
            // Exact match mode - within 50 RPM tolerance
            if (Math.abs(rpm - exactRpm) <= 50) {
              isCandidate = true
              matchType = 'exact'
            }
          } else if (searchMode === 'range' || searchMode === 'auto') {
            // Range match
            if (rpm >= range.min && rpm <= range.max) {
              isCandidate = true
              matchType = 'range'
            }
          }

          if (isCandidate) {
            // Look for hysteresis pair nearby (within 32 bytes)
            let hysteresisOffset = null
            let hysteresisValue = null

            for (let nearby = offset - 32; nearby <= offset + 32; nearby += 2) {
              if (nearby === offset || nearby < 0 || nearby + 2 > activeData.length) continue

              const nearbyValue = readU16(activeData, nearby)
              if (nearbyValue === null) continue

              const nearbyRpm = nearbyValue * factor
              const diff = rpm - nearbyRpm

              if (diff >= HYSTERESIS_RANGE.min && diff <= HYSTERESIS_RANGE.max) {
                hysteresisOffset = nearby
                hysteresisValue = nearbyRpm
                break
              }
            }

            // Look for nearby similar values (potential soft/hard limit pairs)
            let relatedValues = []
            for (let nearby = offset - 64; nearby <= offset + 64; nearby += 2) {
              if (nearby === offset || nearby < 0 || nearby + 2 > activeData.length) continue

              const nearbyValue = readU16(activeData, nearby)
              if (nearbyValue === null) continue

              const nearbyRpm = nearbyValue * factor

              // Within 1000 RPM of each other
              if (Math.abs(nearbyRpm - rpm) <= 1000 && nearbyRpm >= range.min - 500 && nearbyRpm <= range.max + 500) {
                relatedValues.push({ offset: nearby, rpm: nearbyRpm })
              }
            }

            candidates.push({
              offset,
              rawValue: value16,
              rpm: Math.round(rpm),
              scalingFactor: factor,
              scalingLabel: label,
              matchType,
              hysteresis: hysteresisOffset ? {
                offset: hysteresisOffset,
                rpm: Math.round(hysteresisValue),
                diff: Math.round(rpm - hysteresisValue),
              } : null,
              relatedCount: relatedValues.length,
              relatedValues: relatedValues.slice(0, 5),
            })
          }
        }

        // Also check U8 values for some ECUs (only in auto/range mode)
        if (searchMode !== 'exact') {
          const value8 = readU8(activeData, offset)
          for (const { factor, label } of SCALING_FACTORS) {
            if (factor < 4) continue // U8 only makes sense with larger scaling

            const rpm = value8 * factor * 100 // Often U8 * 100 for RPM

            if (rpm >= range.min && rpm <= range.max) {
              candidates.push({
                offset,
                rawValue: value8,
                rpm: Math.round(rpm),
                scalingFactor: factor * 100,
                scalingLabel: `U8 × ${factor * 100}`,
                matchType: 'u8',
                hysteresis: null,
                relatedCount: 0,
                relatedValues: [],
              })
            }
          }
        }
      }

      setProgress(Math.round((chunkEnd / activeData.length) * 100))

      if (chunkEnd < activeData.length - 2) {
        setTimeout(() => processChunk(chunkEnd), 0)
      } else {
        // Score and rank candidates
        const scored = candidates.map(c => {
          let score = 0
          const reasons = []

          // Check if this value appears multiple times in the file
          const occurrences = valueOccurrences.get(c.rawValue) || []
          const occCount = occurrences.length

          // Hysteresis pair is strongest indicator
          if (c.hysteresis) {
            score += 35
            reasons.push('hysteresis')
          }

          // Multiple occurrences of same value (2-8 times is ideal for rev limiters)
          if (occCount >= 2 && occCount <= 8) {
            score += 15 + occCount * 3
            reasons.push(`×${occCount}`)
          } else if (occCount > 8 && occCount <= 20) {
            score += 10
          }
          // Too many occurrences (>20) likely not a rev limiter

          // Related values nearby (soft/hard limit pairs)
          if (c.relatedCount >= 1 && c.relatedCount <= 5) {
            score += c.relatedCount * 8
            reasons.push('related')
          }

          // Common rev limit values
          const commonLimits = [5500, 6000, 6250, 6500, 6800, 7000, 7200, 7500, 8000, 8200, 8500, 9000]
          const isCommonLimit = commonLimits.some(cl => Math.abs(c.rpm - cl) <= 50)
          if (isCommonLimit) {
            score += 15
            reasons.push('common')
          }

          // Round numbers bonus
          if (c.rpm % 1000 === 0) {
            score += 10
          } else if (c.rpm % 500 === 0) {
            score += 5
          } else if (c.rpm % 250 === 0) {
            score += 2
          }

          // Direct RPM scaling (factor = 1) is most common
          if (c.scalingFactor === 1) {
            score += 8
          }

          // Exact search match bonus
          if (c.matchType === 'exact') {
            score += 15
          }

          // Penalize U8 matches (less reliable)
          if (c.matchType === 'u8') {
            score -= 10
          }

          // Penalize very rare scaling factors
          if (c.scalingFactor === 0.125 || c.scalingFactor === 10) {
            score -= 5
          }

          return {
            ...c,
            score: Math.max(0, Math.min(100, score)),
            occurrences: occCount,
            reasons: reasons.join(', ')
          }
        })

        // Sort by score and remove near-duplicates
        scored.sort((a, b) => b.score - a.score)

        const filtered = []
        for (const c of scored) {
          // Skip if too close to an existing better result
          const isDuplicate = filtered.some(f =>
            Math.abs(f.offset - c.offset) < 8 && f.score >= c.score
          )
          if (!isDuplicate) {
            filtered.push(c)
          }
        }

        setResults(filtered.slice(0, 100))
        setIsSearching(false)
      }
    }

    setTimeout(() => processChunk(0), 0)
  }, [activeData, rpmRange, customRpm, searchMode, readU16, readU8])

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
                : 'bg-red-600 hover:bg-red-500 text-white'
            }`}
          >
            {isSearching ? `${progress}%` : 'Find Rev'}
          </button>
        </div>

        {/* Search mode */}
        <div className="flex gap-1">
          <button
            onClick={() => setSearchMode('auto')}
            className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
              searchMode === 'auto' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400'
            }`}
          >
            Auto
          </button>
          <button
            onClick={() => setSearchMode('range')}
            className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
              searchMode === 'range' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400'
            }`}
          >
            Range
          </button>
          <button
            onClick={() => setSearchMode('exact')}
            className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
              searchMode === 'exact' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400'
            }`}
          >
            Exact
          </button>
        </div>

        {/* RPM Range or Exact value */}
        {searchMode === 'exact' ? (
          <input
            type="number"
            value={customRpm}
            onChange={(e) => setCustomRpm(e.target.value)}
            placeholder="Enter exact RPM (e.g., 7000)"
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-200 text-xs font-mono outline-none focus:border-red-500"
            disabled={isSearching}
          />
        ) : (
          <select
            value={rpmRange}
            onChange={(e) => setRpmRange(e.target.value)}
            className="w-full bg-gray-700 text-gray-300 text-xs rounded px-1 py-1 outline-none"
            disabled={isSearching}
          >
            {Object.entries(RPM_RANGES).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        )}

        {results.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-red-400">
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
                className="h-full bg-red-500 transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 text-center mt-2">
              Searching for rev limiters...
            </div>
          </div>
        )}

        {!isSearching && results.length === 0 && (
          <div className="p-3 text-gray-500 text-sm text-center">
            Click "Find Rev" to search
          </div>
        )}

        {!isSearching && results.length > 0 && (
          <div className="divide-y divide-gray-700/50">
            {results.map((result, idx) => (
              <div
                key={`${result.offset}-${result.scalingFactor}`}
                onClick={() => onGoToOffset(result.offset)}
                className="px-2 py-2 hover:bg-gray-700 cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-200 text-xs font-mono">
                      {formatOffset(result.offset)}
                    </span>
                    <span className="text-red-400 text-sm font-bold">
                      {result.rpm} RPM
                    </span>
                  </div>
                  <span className={`text-xs font-bold ${
                    result.score >= 60 ? 'text-green-400' :
                    result.score >= 40 ? 'text-yellow-400' : 'text-gray-400'
                  }`}>
                    {result.score}%
                  </span>
                </div>

                <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                  <span className="font-mono">Raw: {result.rawValue}</span>
                  <span className="text-gray-600">|</span>
                  <span>{result.scalingLabel}</span>
                </div>
                {result.reasons && (
                  <div className="mt-0.5 text-xs text-blue-400">
                    {result.reasons}
                  </div>
                )}

                {result.hysteresis && (
                  <div className="mt-1 text-xs text-purple-400">
                    ↳ Hysteresis: {result.hysteresis.rpm} RPM (-{result.hysteresis.diff}) @ {formatOffset(result.hysteresis.offset)}
                  </div>
                )}

                {result.relatedCount > 0 && (
                  <div className="mt-1 text-xs text-cyan-400">
                    ↳ {result.relatedCount} related value{result.relatedCount !== 1 ? 's' : ''} nearby
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-2 py-2 border-t border-gray-700 text-xs text-gray-600">
        <div>Score based on: round numbers, hysteresis pairs, repeated values, common limits</div>
      </div>
    </div>
  )
}

export default RevLimitFinder
