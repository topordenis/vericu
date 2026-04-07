import { useState, useRef, useMemo } from 'react'

const PAGE_SIZE = 100

const TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'map', label: 'MAP', test: (t) => t.rows > 1 && t.cols > 1 },
  { key: 'curve', label: 'CRV', test: (t) => (t.rows === 1 && t.cols > 1) || (t.rows > 1 && t.cols === 1) },
  { key: 'value', label: 'VAL', test: (t) => t.rows === 1 && t.cols === 1 },
]

const SOURCE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'a2l', label: 'A2L', test: (t) => t.source === 'a2l' },
  { key: 'matched', label: 'B-Matched', test: (t) => t.offsetB != null },
  { key: 'manual', label: 'Manual', test: (t) => !t.source },
]

function getTableType(t) {
  if (t.rows > 1 && t.cols > 1) return 'map'
  if ((t.rows === 1 && t.cols > 1) || (t.rows > 1 && t.cols === 1)) return 'curve'
  return 'value'
}

const TYPE_COLORS = {
  map: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  curve: 'text-sky-400 bg-sky-400/10 border-sky-400/20',
  value: 'text-gray-400 bg-gray-400/10 border-gray-400/20',
}

const TYPE_LABELS = { map: 'MAP', curve: 'CRV', value: 'VAL' }

function TableList({ tables, onSelect, onEdit, onDelete, onGoToOffset, selectedId, onCopyTable }) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const searchRef = useRef(null)
  const scrollRef = useRef(null)

  const typeCounts = useMemo(() => {
    const counts = { all: tables.length, map: 0, curve: 0, value: 0 }
    for (const t of tables) counts[getTableType(t)]++
    return counts
  }, [tables])

  const sourceCounts = useMemo(() => {
    const counts = { all: tables.length, a2l: 0, matched: 0, manual: 0 }
    for (const t of tables) {
      if (t.source === 'a2l') counts.a2l++
      else counts.manual++
      if (t.offsetB != null) counts.matched++
    }
    return counts
  }, [tables])

  // Only show source filters if there are mixed sources
  const hasMultipleSources = [sourceCounts.a2l, sourceCounts.matched, sourceCounts.manual].filter(c => c > 0).length > 1

  const filtered = useMemo(() => {
    let result = tables
    if (typeFilter !== 'all') {
      const filter = TYPE_FILTERS.find(f => f.key === typeFilter)
      if (filter?.test) result = result.filter(filter.test)
    }
    if (sourceFilter !== 'all') {
      const filter = SOURCE_FILTERS.find(f => f.key === sourceFilter)
      if (filter?.test) result = result.filter(filter.test)
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(t => t.name.toLowerCase().includes(q))
    }
    return result
  }, [tables, search, typeFilter, sourceFilter])

  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  const handleScroll = (e) => {
    const el = e.target
    if (hasMore && el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      setVisibleCount(v => Math.min(v + PAGE_SIZE, filtered.length))
    }
  }

  const resetScroll = () => {
    setVisibleCount(PAGE_SIZE)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  const handleFilterChange = (key) => { setTypeFilter(key); resetScroll() }
  const handleSourceChange = (key) => { setSourceFilter(key); resetScroll() }
  const handleSearchChange = (val) => { setSearch(val); resetScroll() }

  if (tables.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-gray-600 text-sm text-center">
          <div className="text-gray-500 mb-1">No tables defined</div>
          <div className="text-xs">Create one manually or import an A2L file</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-2 shrink-0">
        <div className="relative">
          <svg className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Filter tables..."
            className="w-full bg-gray-900/80 border border-gray-700/50 rounded-md pl-7 pr-7 py-1 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 focus:bg-gray-900"
          />
          {search && (
            <button
              onClick={() => { handleSearchChange(''); searchRef.current?.focus() }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 p-0.5"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Type filter pills */}
      <div className="flex gap-1 px-2 pb-1.5 shrink-0">
        {TYPE_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleFilterChange(key)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              typeFilter === key
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'text-gray-500 hover:text-gray-300 border border-transparent hover:border-gray-700'
            }`}
          >
            {label}
            <span className="ml-1 opacity-60">{typeCounts[key]}</span>
          </button>
        ))}
      </div>

      {/* Source filter pills */}
      {hasMultipleSources && (
        <div className="flex gap-1 px-2 pb-1.5 shrink-0">
          {SOURCE_FILTERS.filter(f => f.key === 'all' || sourceCounts[f.key] > 0).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleSourceChange(key)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                sourceFilter === key
                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                  : 'text-gray-500 hover:text-gray-300 border border-transparent hover:border-gray-700'
              }`}
            >
              {label}
              <span className="ml-1 opacity-60">{sourceCounts[key]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Results count */}
      {(search || typeFilter !== 'all' || sourceFilter !== 'all') && (
        <div className="px-2 pb-1 text-xs text-gray-600 shrink-0">
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </div>
      )}

      <div className="border-t border-gray-700/50" />

      {/* Scrollable list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        onScroll={handleScroll}
      >
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-gray-600 text-sm">No matches</div>
        ) : (
          <>
            {visible.map((table) => {
              const type = getTableType(table)
              return (
                <div
                  key={table.id}
                  onClick={() => onSelect(table)}
                  className={`group px-2 py-1.5 border-b border-gray-700/30 cursor-pointer transition-colors ${
                    selectedId === table.id
                      ? 'bg-blue-500/10 border-l-2 border-l-blue-500'
                      : 'hover:bg-gray-800/60 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-[10px] font-mono px-1 py-px rounded border shrink-0 ${TYPE_COLORS[type]}`}>
                      {TYPE_LABELS[type]}
                    </span>
                    <span className="text-gray-200 text-sm truncate flex-1">{table.name}</span>
                    <div className="flex shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {onGoToOffset && (
                        <button onClick={(e) => { e.stopPropagation(); onGoToOffset(table.offset, table) }} className="text-gray-500 hover:text-blue-400 p-0.5" title="Go to offset">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </button>
                      )}
                      {onCopyTable && (
                        <button onClick={(e) => { e.stopPropagation(); onCopyTable(table) }} className="text-gray-500 hover:text-green-400 p-0.5" title="Copy table bytes">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); onEdit(table) }} className="text-gray-500 hover:text-gray-300 p-0.5" title="Edit">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); onDelete(table.id) }} className="text-gray-500 hover:text-red-400 p-0.5" title="Delete">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-0.5 text-[11px] text-gray-500 font-mono pl-[38px]">
                    <span>{table.rows}×{table.cols}</span>
                    <span>{table.dataType.toUpperCase()}</span>
                    <span>0x{table.offset.toString(16).toUpperCase()}</span>
                    {table.offsetB != null && (
                      <span
                        className={`font-sans ${table._matchConfidence >= 0.85 ? 'text-green-500' : table._matchConfidence >= 0.6 ? 'text-yellow-500' : 'text-orange-500'}`}
                        title={`${table._matchMethod} · ${Math.round(table._matchConfidence * 100)}% match → B:0x${table.offsetB.toString(16).toUpperCase()}`}
                      >
                        B:{Math.round(table._matchConfidence * 100)}%
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            {hasMore && (
              <div className="p-2 text-center text-xs text-gray-600">
                Showing {visible.length} of {filtered.length} — scroll for more
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default TableList
