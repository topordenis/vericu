import { useState, useMemo } from 'react'

// Checksum algorithms
const algorithms = {
  sagem_s3000: {
    name: 'Sagem S3000 (sum16 BE)',
    calculate: (data, start, end) => {
      let sum = 0
      for (let i = start; i <= end && i < data.length; i++) {
        sum = (sum + data[i]) & 0xFFFF
      }
      return sum
    },
    size: 2,
    storeBigEndian: true, // This algorithm stores result as big-endian
  },
  sum8: {
    name: 'Sum (8-bit)',
    calculate: (data, start, end) => {
      let sum = 0
      for (let i = start; i <= end && i < data.length; i++) {
        sum = (sum + data[i]) & 0xFF
      }
      return sum
    },
    size: 1,
  },
  sum16: {
    name: 'Sum (16-bit)',
    calculate: (data, start, end, littleEndian) => {
      let sum = 0
      for (let i = start; i <= end && i < data.length; i++) {
        sum = (sum + data[i]) & 0xFFFF
      }
      return sum
    },
    size: 2,
  },
  sum32: {
    name: 'Sum (32-bit)',
    calculate: (data, start, end) => {
      let sum = 0
      for (let i = start; i <= end && i < data.length; i++) {
        sum = (sum + data[i]) >>> 0
      }
      return sum >>> 0
    },
    size: 4,
  },
  sum16_words: {
    name: 'Sum 16-bit words',
    calculate: (data, start, end, littleEndian) => {
      let sum = 0
      for (let i = start; i <= end - 1 && i < data.length - 1; i += 2) {
        const word = littleEndian
          ? data[i] | (data[i + 1] << 8)
          : (data[i] << 8) | data[i + 1]
        sum = (sum + word) & 0xFFFF
      }
      return sum
    },
    size: 2,
  },
  sum32_words: {
    name: 'Sum 32-bit words',
    calculate: (data, start, end, littleEndian) => {
      let sum = 0
      for (let i = start; i <= end - 3 && i < data.length - 3; i += 4) {
        const dword = littleEndian
          ? data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)
          : (data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]
        sum = (sum + (dword >>> 0)) >>> 0
      }
      return sum >>> 0
    },
    size: 4,
  },
  xor8: {
    name: 'XOR (8-bit)',
    calculate: (data, start, end) => {
      let xor = 0
      for (let i = start; i <= end && i < data.length; i++) {
        xor ^= data[i]
      }
      return xor
    },
    size: 1,
  },
  xor16: {
    name: 'XOR (16-bit)',
    calculate: (data, start, end, littleEndian) => {
      let xor = 0
      for (let i = start; i <= end - 1 && i < data.length - 1; i += 2) {
        const word = littleEndian
          ? data[i] | (data[i + 1] << 8)
          : (data[i] << 8) | data[i + 1]
        xor ^= word
      }
      return xor
    },
    size: 2,
  },
  xor32: {
    name: 'XOR (32-bit)',
    calculate: (data, start, end, littleEndian) => {
      let xor = 0
      for (let i = start; i <= end - 3 && i < data.length - 3; i += 4) {
        const dword = littleEndian
          ? data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)
          : (data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]
        xor ^= dword >>> 0
      }
      return xor >>> 0
    },
    size: 4,
  },
  complement16: {
    name: 'Complement (16-bit)',
    calculate: (data, start, end, littleEndian) => {
      let sum = 0
      for (let i = start; i <= end && i < data.length; i++) {
        sum = (sum + data[i]) & 0xFFFF
      }
      return (~sum) & 0xFFFF
    },
    size: 2,
  },
  complement32: {
    name: 'Complement (32-bit)',
    calculate: (data, start, end) => {
      let sum = 0
      for (let i = start; i <= end && i < data.length; i++) {
        sum = (sum + data[i]) >>> 0
      }
      return (~sum) >>> 0
    },
    size: 4,
  },
  crc16: {
    name: 'CRC-16 (CCITT)',
    calculate: (data, start, end) => {
      let crc = 0xFFFF
      for (let i = start; i <= end && i < data.length; i++) {
        crc ^= data[i] << 8
        for (let j = 0; j < 8; j++) {
          if (crc & 0x8000) {
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF
          } else {
            crc = (crc << 1) & 0xFFFF
          }
        }
      }
      return crc
    },
    size: 2,
  },
  crc32: {
    name: 'CRC-32',
    calculate: (data, start, end) => {
      let crc = 0xFFFFFFFF
      for (let i = start; i <= end && i < data.length; i++) {
        crc ^= data[i]
        for (let j = 0; j < 8; j++) {
          if (crc & 1) {
            crc = ((crc >>> 1) ^ 0xEDB88320) >>> 0
          } else {
            crc = crc >>> 1
          }
        }
      }
      return (~crc) >>> 0
    },
    size: 4,
  },
  negsum16_words: {
    name: 'Neg Sum 16-bit words',
    calculate: (data, start, end, littleEndian) => {
      let sum = 0
      for (let i = start; i <= end - 1 && i < data.length - 1; i += 2) {
        const word = littleEndian
          ? data[i] | (data[i + 1] << 8)
          : (data[i] << 8) | data[i + 1]
        sum = (sum + word) & 0xFFFF
      }
      return (0x10000 - sum) & 0xFFFF
    },
    size: 2,
  },
  negsum32_words: {
    name: 'Neg Sum 32-bit words',
    calculate: (data, start, end, littleEndian) => {
      let sum = 0n
      for (let i = start; i <= end - 3 && i < data.length - 3; i += 4) {
        const dword = littleEndian
          ? data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)
          : (data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]
        sum += BigInt(dword >>> 0)
      }
      return Number((0x100000000n - (sum & 0xFFFFFFFFn)) & 0xFFFFFFFFn)
    },
    size: 4,
  },
}

function parseHexInput(value) {
  const cleaned = value.trim().toLowerCase().replace(/^0x/, '')
  const num = parseInt(cleaned, 16)
  return isNaN(num) ? null : num
}

export default function ChecksumCalculator({ dataA, dataB, dataC, endianness, onGoToOffset, onUpdateData }) {
  const [rangeStart, setRangeStart] = useState('0')
  const [rangeEnd, setRangeEnd] = useState('FF7D')
  const [checksumAddr, setChecksumAddr] = useState('FF7E')
  const [algorithm, setAlgorithm] = useState('sagem_s3000')
  const [activeFile, setActiveFile] = useState('A')
  const [excludeRanges, setExcludeRanges] = useState('') // e.g., "FF80-FF8F,FFE0-FFFF"

  const currentData = activeFile === 'A' ? dataA : activeFile === 'B' ? dataB : dataC
  const littleEndian = endianness === 'little'

  // Parse exclude ranges
  const parsedExcludes = useMemo(() => {
    if (!excludeRanges.trim()) return []
    return excludeRanges.split(',').map(range => {
      const [start, end] = range.trim().split('-').map(v => parseHexInput(v))
      return start !== null && end !== null ? { start, end } : null
    }).filter(Boolean)
  }, [excludeRanges])

  // Check if address is excluded
  const isExcluded = (addr) => {
    return parsedExcludes.some(r => addr >= r.start && addr <= r.end)
  }

  // Calculate checksum
  const result = useMemo(() => {
    if (!currentData) return null

    const start = parseHexInput(rangeStart)
    const end = parseHexInput(rangeEnd)
    const csAddr = parseHexInput(checksumAddr)

    if (start === null || end === null) return null
    if (start > end || start < 0 || end >= currentData.length) return null

    const algo = algorithms[algorithm]
    if (!algo) return null

    // If we have excludes, create filtered data indices
    if (parsedExcludes.length > 0) {
      // Build a filtered copy for algorithms that need contiguous data
      const filteredData = []
      for (let i = start; i <= end && i < currentData.length; i++) {
        if (!isExcluded(i)) {
          filteredData.push(currentData[i])
        }
      }
      const tempData = new Uint8Array(filteredData)
      return {
        calculated: algo.calculate(tempData, 0, tempData.length - 1, littleEndian),
        size: algo.size,
        csAddr,
        storeBigEndian: algo.storeBigEndian || false,
      }
    }

    return {
      calculated: algo.calculate(currentData, start, end, littleEndian),
      size: algo.size,
      csAddr,
      storeBigEndian: algo.storeBigEndian || false,
    }
  }, [currentData, rangeStart, rangeEnd, algorithm, littleEndian, parsedExcludes])

  // Get stored value at checksum address
  const storedValue = useMemo(() => {
    if (!currentData || !result) return null
    const addr = result.csAddr
    if (addr === null || addr < 0 || addr + result.size > currentData.length) return null

    // Use big-endian if algorithm specifies it, otherwise use global endianness
    const useBigEndian = result.storeBigEndian || !littleEndian

    if (result.size === 1) {
      return currentData[addr]
    } else if (result.size === 2) {
      return useBigEndian
        ? (currentData[addr] << 8) | currentData[addr + 1]
        : currentData[addr] | (currentData[addr + 1] << 8)
    } else if (result.size === 4) {
      return useBigEndian
        ? ((currentData[addr] << 24) | (currentData[addr + 1] << 16) | (currentData[addr + 2] << 8) | currentData[addr + 3]) >>> 0
        : (currentData[addr] | (currentData[addr + 1] << 8) | (currentData[addr + 2] << 16) | (currentData[addr + 3] << 24)) >>> 0
    }
    return null
  }, [currentData, result, littleEndian])

  const formatHex = (value, size) => {
    if (value === null || value === undefined) return '?'
    const hex = value.toString(16).toUpperCase()
    return '0x' + hex.padStart(size * 2, '0')
  }

  const match = result && storedValue !== null && result.calculated === storedValue

  // Fix checksum by writing calculated value to the checksum address
  const handleFixChecksum = () => {
    if (!currentData || !result || !onUpdateData) return

    const addr = result.csAddr
    if (addr === null || addr < 0 || addr + result.size > currentData.length) return

    // Create a copy of the data
    const newData = new Uint8Array(currentData)

    // Write the calculated checksum
    const useBigEndian = result.storeBigEndian

    if (result.size === 1) {
      newData[addr] = result.calculated & 0xFF
    } else if (result.size === 2) {
      if (useBigEndian) {
        newData[addr] = (result.calculated >> 8) & 0xFF
        newData[addr + 1] = result.calculated & 0xFF
      } else {
        newData[addr] = result.calculated & 0xFF
        newData[addr + 1] = (result.calculated >> 8) & 0xFF
      }
    } else if (result.size === 4) {
      if (useBigEndian) {
        newData[addr] = (result.calculated >> 24) & 0xFF
        newData[addr + 1] = (result.calculated >> 16) & 0xFF
        newData[addr + 2] = (result.calculated >> 8) & 0xFF
        newData[addr + 3] = result.calculated & 0xFF
      } else {
        newData[addr] = result.calculated & 0xFF
        newData[addr + 1] = (result.calculated >> 8) & 0xFF
        newData[addr + 2] = (result.calculated >> 16) & 0xFF
        newData[addr + 3] = (result.calculated >> 24) & 0xFF
      }
    }

    onUpdateData(activeFile, newData)
  }

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="p-2 border-b border-gray-700">
        <div className="text-xs text-gray-400 mb-2">Checksum Calculator</div>

        {/* File selector */}
        <div className="flex gap-1 mb-2">
          {dataA && (
            <button
              onClick={() => setActiveFile('A')}
              className={`px-2 py-0.5 text-xs rounded ${
                activeFile === 'A' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'
              }`}
            >
              A
            </button>
          )}
          {dataB && (
            <button
              onClick={() => setActiveFile('B')}
              className={`px-2 py-0.5 text-xs rounded ${
                activeFile === 'B' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'
              }`}
            >
              B
            </button>
          )}
          {dataC && (
            <button
              onClick={() => setActiveFile('C')}
              className={`px-2 py-0.5 text-xs rounded ${
                activeFile === 'C' ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-400'
              }`}
            >
              C
            </button>
          )}
        </div>

        {/* Algorithm selector */}
        <div className="mb-2">
          <label className="text-xs text-gray-500">Algorithm</label>
          <select
            value={algorithm}
            onChange={(e) => setAlgorithm(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 outline-none"
          >
            <optgroup label="ECU Specific">
              <option value="sagem_s3000">Sagem S3000 (sum16 BE)</option>
            </optgroup>
            <optgroup label="Simple Sum">
              <option value="sum8">Sum (8-bit)</option>
              <option value="sum16">Sum (16-bit)</option>
              <option value="sum32">Sum (32-bit)</option>
              <option value="sum16_words">Sum 16-bit words</option>
              <option value="sum32_words">Sum 32-bit words</option>
            </optgroup>
            <optgroup label="Complement">
              <option value="complement16">Complement (16-bit)</option>
              <option value="complement32">Complement (32-bit)</option>
              <option value="negsum16_words">Neg Sum 16-bit words</option>
              <option value="negsum32_words">Neg Sum 32-bit words</option>
            </optgroup>
            <optgroup label="XOR">
              <option value="xor8">XOR (8-bit)</option>
              <option value="xor16">XOR (16-bit)</option>
              <option value="xor32">XOR (32-bit)</option>
            </optgroup>
            <optgroup label="CRC">
              <option value="crc16">CRC-16 (CCITT)</option>
              <option value="crc32">CRC-32</option>
            </optgroup>
          </select>
        </div>

        {/* Range inputs */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className="text-xs text-gray-500">Start (hex)</label>
            <input
              type="text"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs font-mono text-gray-200 outline-none"
              placeholder="0"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">End (hex)</label>
            <input
              type="text"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs font-mono text-gray-200 outline-none"
              placeholder="FFFF"
            />
          </div>
        </div>

        {/* Checksum address */}
        <div className="mb-2">
          <label className="text-xs text-gray-500">Checksum stored at (hex)</label>
          <input
            type="text"
            value={checksumAddr}
            onChange={(e) => setChecksumAddr(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs font-mono text-gray-200 outline-none"
            placeholder="FF84"
          />
        </div>

        {/* Exclude ranges */}
        <div className="mb-2">
          <label className="text-xs text-gray-500">Exclude ranges (hex, e.g., FF80-FF8F,FFE0-FFFF)</label>
          <input
            type="text"
            value={excludeRanges}
            onChange={(e) => setExcludeRanges(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs font-mono text-gray-200 outline-none"
            placeholder="FF80-FF8F"
          />
        </div>
      </div>

      {/* Results */}
      {currentData && result && (
        <div className="p-2 space-y-2">
          <div className="bg-gray-800 rounded p-2">
            <div className="text-xs text-gray-500 mb-1">Calculated</div>
            <div className="font-mono text-lg text-yellow-400">
              {formatHex(result.calculated, result.size)}
            </div>
            <div className="text-xs text-gray-500">
              = {result.calculated}
            </div>
          </div>

          <div className="bg-gray-800 rounded p-2">
            <div className="text-xs text-gray-500 mb-1">
              Stored @ 0x{checksumAddr.toUpperCase()}
              <button
                onClick={() => onGoToOffset?.(parseHexInput(checksumAddr))}
                className="ml-2 text-blue-400 hover:text-blue-300"
              >
                Go
              </button>
            </div>
            <div className={`font-mono text-lg ${match ? 'text-green-400' : 'text-red-400'}`}>
              {formatHex(storedValue, result.size)}
            </div>
            <div className="text-xs text-gray-500">
              = {storedValue}
            </div>
          </div>

          <div className={`text-center py-1 rounded text-sm font-medium ${
            match ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
          }`}>
            {match ? 'MATCH' : 'NO MATCH'}
          </div>

          {!match && result && onUpdateData && (
            <button
              onClick={handleFixChecksum}
              className="w-full py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              Fix Checksum
            </button>
          )}

          {!match && storedValue !== null && (
            <div className="bg-gray-800 rounded p-2">
              <div className="text-xs text-gray-500 mb-1">Difference</div>
              <div className="font-mono text-xs text-gray-300">
                Calc - Stored = {formatHex((result.calculated - storedValue) >>> 0, result.size)}
              </div>
              <div className="font-mono text-xs text-gray-300">
                Stored - Calc = {formatHex((storedValue - result.calculated) >>> 0, result.size)}
              </div>
            </div>
          )}
        </div>
      )}

      {!currentData && (
        <div className="p-4 text-center text-gray-500 text-xs">
          Load a file to calculate checksum
        </div>
      )}
    </div>
  )
}
