import { useMemo, useState } from 'react'

function SearchPanel({ dataA, dataB, dataC, endianness, onGoToOffset }) {
  const [searchValue, setSearchValue] = useState('')
  const [searchType, setSearchType] = useState('hex') // 'hex', 'u8', 'u16', 'u32', 'i8', 'i16', 'i32', 'text'
  const [searchIn, setSearchIn] = useState('A') // 'A', 'B', 'C'

  const activeData = searchIn === 'C' ? dataC : searchIn === 'B' ? dataB : dataA

  const results = useMemo(() => {
    if (!activeData || !searchValue.trim()) return []

    const isLE = endianness === 'little'
    const matches = []
    const maxResults = 500

    try {
      if (searchType === 'hex') {
        // Search for hex byte sequence (e.g., "FF 00 1A" or "FF001A")
        const hexStr = searchValue.replace(/\s+/g, '').replace(/^0x/i, '')
        if (!/^[0-9A-Fa-f]*$/.test(hexStr) || hexStr.length === 0 || hexStr.length % 2 !== 0) {
          return []
        }

        const bytes = []
        for (let i = 0; i < hexStr.length; i += 2) {
          bytes.push(parseInt(hexStr.substr(i, 2), 16))
        }

        for (let i = 0; i <= activeData.length - bytes.length && matches.length < maxResults; i++) {
          let found = true
          for (let j = 0; j < bytes.length; j++) {
            if (activeData[i + j] !== bytes[j]) {
              found = false
              break
            }
          }
          if (found) {
            matches.push({
              offset: i,
              preview: bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
            })
          }
        }
      } else if (searchType === 'text') {
        // Search for ASCII text
        const searchBytes = []
        for (let i = 0; i < searchValue.length; i++) {
          searchBytes.push(searchValue.charCodeAt(i))
        }

        for (let i = 0; i <= activeData.length - searchBytes.length && matches.length < maxResults; i++) {
          let found = true
          for (let j = 0; j < searchBytes.length; j++) {
            if (activeData[i + j] !== searchBytes[j]) {
              found = false
              break
            }
          }
          if (found) {
            matches.push({
              offset: i,
              preview: `"${searchValue}"`,
            })
          }
        }
      } else {
        // Numeric search (u8, i8, u16, i16, u32, i32)
        const size = searchType.includes('8') ? 1 : searchType.includes('16') ? 2 : 4
        const signed = searchType.startsWith('i')

        let targetValue = parseInt(searchValue, 10)
        if (isNaN(targetValue)) return []

        // Handle negative values for signed types
        if (signed && targetValue < 0) {
          const maxUnsigned = 1 << (size * 8)
          targetValue = targetValue + maxUnsigned
        }

        // Convert target to bytes based on endianness
        const targetBytes = []
        for (let i = 0; i < size; i++) {
          if (isLE) {
            // Little endian: low byte at low address
            targetBytes.push((targetValue >> (i * 8)) & 0xFF)
          } else {
            // Big endian: high byte at low address
            targetBytes.push((targetValue >> ((size - 1 - i) * 8)) & 0xFF)
          }
        }

        for (let i = 0; i <= activeData.length - size && matches.length < maxResults; i++) {
          let found = true
          for (let j = 0; j < size; j++) {
            if (activeData[i + j] !== targetBytes[j]) {
              found = false
              break
            }
          }
          if (found) {
            matches.push({
              offset: i,
              preview: targetValue.toString(),
            })
          }
        }
      }
    } catch (e) {
      console.error('Search error:', e)
      return []
    }

    return matches
  }, [activeData, searchValue, searchType, endianness])

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
      {/* Search controls */}
      <div className="px-2 py-2 border-b border-gray-700 space-y-2">
        <input
          type="text"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder={searchType === 'hex' ? 'FF 00 1A...' : searchType === 'text' ? 'text...' : 'value...'}
          className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-200 text-xs font-mono outline-none focus:border-blue-500"
        />
        <div className="flex items-center gap-2">
          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value)}
            className="flex-1 bg-gray-700 text-gray-300 text-xs rounded px-1 py-1 outline-none"
          >
            <option value="hex">Hex</option>
            <option value="text">Text</option>
            <option value="u8">U8</option>
            <option value="i8">I8</option>
            <option value="u16">U16</option>
            <option value="i16">I16</option>
            <option value="u32">U32</option>
            <option value="i32">I32</option>
          </select>
          <select
            value={searchIn}
            onChange={(e) => setSearchIn(e.target.value)}
            className="bg-gray-700 text-gray-300 text-xs rounded px-1 py-1 outline-none"
          >
            {dataA && <option value="A">File A</option>}
            {dataB && <option value="B">File B</option>}
            {dataC && <option value="C">File C</option>}
          </select>
        </div>
        {searchValue && (
          <div className="text-xs text-gray-500">
            {results.length === 500 ? '500+ matches' : `${results.length} match${results.length !== 1 ? 'es' : ''}`}
          </div>
        )}
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto">
        {results.length === 0 && searchValue ? (
          <div className="p-3 text-gray-500 text-sm text-center">
            No matches found
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {results.map((result) => (
              <div
                key={result.offset}
                onClick={() => onGoToOffset(result.offset)}
                className="px-2 py-1.5 cursor-pointer transition-colors hover:bg-gray-700"
              >
                <div className="flex items-center justify-between">
                  <span className="text-gray-200 text-xs font-mono">
                    {formatOffset(result.offset)}
                  </span>
                  <span className="text-green-400 text-xs font-mono truncate ml-2">
                    {result.preview}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default SearchPanel
