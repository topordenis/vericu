import { useMemo, useState } from 'react'

function DiffList({ dataA, dataB, diffPair, onGoToOffset, onViewAsTable }) {
  const [gapThreshold, setGapThreshold] = useState(64) // bytes - merge regions within this gap

  // First find all individual diff regions
  const rawDiffRegions = useMemo(() => {
    if (!dataA || !dataB) return []

    const regions = []
    const maxLen = Math.max(dataA.length, dataB.length)

    let rangeStart = null
    let rangeBytes = 0

    for (let i = 0; i <= maxLen; i++) {
      const byteA = i < dataA.length ? dataA[i] : undefined
      const byteB = i < dataB.length ? dataB[i] : undefined
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
  }, [dataA, dataB])

  // Cluster nearby regions
  const clusteredRegions = useMemo(() => {
    if (rawDiffRegions.length === 0) return []

    const [labelFirst, labelSecond] = diffPair.split('-')
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
  }, [rawDiffRegions, gapThreshold, diffPair])

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

  if (!dataA || !dataB) {
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
