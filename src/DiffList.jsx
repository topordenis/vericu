import { useMemo, useState } from 'react'

function DiffList({ dataA, dataB, dataC, onGoToOffset, onViewAsTable, onSaveAsTable }) {
  const [gapThreshold, setGapThreshold] = useState(64) // bytes - merge regions within this gap
  const [diffPair, setDiffPair] = useState('A-B')

  // Get available diff pairs based on loaded files
  const availablePairs = useMemo(() => {
    const pairs = []
    if (dataA && dataB) pairs.push('A-B')
    if (dataA && dataC) pairs.push('A-C')
    if (dataB && dataC) pairs.push('B-C')
    return pairs
  }, [dataA, dataB, dataC])

  // Auto-select first available pair if current is invalid
  const effectivePair = availablePairs.includes(diffPair) ? diffPair : availablePairs[0] || 'A-B'

  // Get the two files to compare based on selected pair
  const [firstData, secondData] = useMemo(() => {
    const files = { A: dataA, B: dataB, C: dataC }
    const [first, second] = effectivePair.split('-')
    return [files[first], files[second]]
  }, [effectivePair, dataA, dataB, dataC])

  // First find all individual diff regions
  const rawDiffRegions = useMemo(() => {
    if (!firstData || !secondData) return []

    const regions = []
    const maxLen = Math.max(firstData.length, secondData.length)

    let rangeStart = null
    let rangeBytes = 0

    for (let i = 0; i <= maxLen; i++) {
      const byteA = i < firstData.length ? firstData[i] : undefined
      const byteB = i < secondData.length ? secondData[i] : undefined
      const isDifferent = byteA !== byteB

      if (isDifferent && rangeStart === null) {
        rangeStart = i
        rangeBytes = 1
      } else if (isDifferent && rangeStart !== null) {
        rangeBytes++
      } else if (!isDifferent && rangeStart !== null) {
        regions.push({
          start: rangeStart,
          end: i - 1,
          size: rangeBytes,
        })
        rangeStart = null
        rangeBytes = 0
      }
    }

    if (rangeStart !== null) {
      regions.push({
        start: rangeStart,
        end: rangeStart + rangeBytes - 1,
        size: rangeBytes,
      })
    }

    return regions
  }, [firstData, secondData])

  // Cluster nearby regions
  const clusteredRegions = useMemo(() => {
    if (rawDiffRegions.length === 0) return []

    const [labelFirst, labelSecond] = effectivePair.split('-')
    const clusters = []
    let currentCluster = { ...rawDiffRegions[0], diffCount: 1 }

    for (let i = 1; i < rawDiffRegions.length; i++) {
      const region = rawDiffRegions[i]
      const gap = region.start - currentCluster.end - 1

      if (gap <= gapThreshold) {
        // Merge into current cluster
        currentCluster.end = region.end
        currentCluster.size = currentCluster.end - currentCluster.start + 1
        currentCluster.diffCount++
      } else {
        // Save current cluster and start new one
        clusters.push({
          ...currentCluster,
          labelFirst,
          labelSecond,
        })
        currentCluster = { ...region, diffCount: 1 }
      }
    }

    // Don't forget last cluster
    clusters.push({
      ...currentCluster,
      labelFirst,
      labelSecond,
    })

    return clusters
  }, [rawDiffRegions, gapThreshold, effectivePair])

  const formatOffset = (offset) => {
    return '0x' + offset.toString(16).toUpperCase().padStart(6, '0')
  }

  const formatSize = (size) => {
    if (size >= 1024 * 1024) {
      return `${(size / (1024 * 1024)).toFixed(1)}MB`
    }
    if (size >= 1024) {
      return `${(size / 1024).toFixed(1)}KB`
    }
    return `${size}B`
  }

  if (!firstData || !secondData) {
    return (
      <div className="p-3 text-gray-500 text-sm text-center">
        Load 2+ files to see differences
      </div>
    )
  }

  const totalDiffBytes = rawDiffRegions.reduce((sum, r) => sum + r.size, 0)

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="px-2 py-2 border-b border-gray-700 space-y-2">
        {/* Diff pair selector */}
        <div className="flex items-center gap-1">
          {availablePairs.map((pair) => (
            <button
              key={pair}
              onClick={() => setDiffPair(pair)}
              className={`flex-1 px-2 py-1 rounded text-xs font-mono transition-colors ${
                effectivePair === pair
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              {pair.replace('-', '↔')}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {clusteredRegions.length} cluster{clusteredRegions.length !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-purple-400 font-mono">
            {formatSize(totalDiffBytes)} changed
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Gap:</span>
          <input
            type="range"
            min="0"
            max="512"
            step="8"
            value={gapThreshold}
            onChange={(e) => setGapThreshold(Number(e.target.value))}
            className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
          <span className="text-xs text-gray-400 font-mono w-12 text-right">
            {gapThreshold}B
          </span>
        </div>
      </div>

      {/* Clusters list */}
      <div className="flex-1 overflow-y-auto">
        {clusteredRegions.length === 0 ? (
          <div className="p-3 text-gray-500 text-sm text-center">
            Files are identical
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {clusteredRegions.map((cluster) => (
              <div
                key={cluster.start}
                className="px-2 py-2 transition-colors hover:bg-gray-700 group"
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-gray-200 text-xs font-mono cursor-pointer hover:text-blue-400"
                    onClick={() => onGoToOffset(cluster.start)}
                    title="Go to offset"
                  >
                    {formatOffset(cluster.start)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-purple-400 text-xs font-mono">
                      {formatSize(cluster.size)}
                    </span>
                    <button
                      onClick={() => onViewAsTable(cluster)}
                      className="text-gray-500 hover:text-green-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="View as table"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                    {onSaveAsTable && (
                      <button
                        onClick={() => {
                          const cols = Math.min(16, cluster.size)
                          const rows = Math.ceil(cluster.size / cols)
                          onSaveAsTable({
                            name: `Diff @ 0x${cluster.start.toString(16).toUpperCase()}`,
                            offset: cluster.start,
                            rows,
                            cols,
                            dataType: 'u8',
                          })
                        }}
                        className="text-gray-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Save as table"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span
                    className="text-gray-500 text-xs cursor-pointer hover:text-blue-400"
                    onClick={() => onGoToOffset(cluster.end)}
                    title="Go to end offset"
                  >
                    → {formatOffset(cluster.end)}
                  </span>
                  {cluster.diffCount > 1 && (
                    <span className="text-gray-600 text-xs">
                      {cluster.diffCount} regions
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default DiffList
