// Intel HEX (.hex) file parser
// Converts Intel HEX format to a flat Uint8Array binary

/**
 * Parse an Intel HEX file into a flat binary Uint8Array.
 * Returns { data: Uint8Array, startAddress: number, endAddress: number }
 */
export function parseIntelHex(text) {
  const lines = text.split(/\r?\n/).filter(l => l.startsWith(':'))
  if (lines.length === 0) return null

  // First pass: find address range
  let baseAddress = 0
  let minAddr = Infinity
  let maxAddr = 0

  for (const line of lines) {
    const byteCount = parseInt(line.slice(1, 3), 16)
    const address = parseInt(line.slice(3, 7), 16)
    const type = parseInt(line.slice(7, 9), 16)

    if (type === 0x04) {
      // Extended linear address
      baseAddress = parseInt(line.slice(9, 13), 16) << 16
    } else if (type === 0x02) {
      // Extended segment address
      baseAddress = parseInt(line.slice(9, 13), 16) << 4
    } else if (type === 0x00) {
      // Data record
      const fullAddr = baseAddress + address
      minAddr = Math.min(minAddr, fullAddr)
      maxAddr = Math.max(maxAddr, fullAddr + byteCount)
    } else if (type === 0x01) {
      // EOF
      break
    }
  }

  if (minAddr === Infinity) return null

  const data = new Uint8Array(maxAddr - minAddr)
  data.fill(0xFF) // unprogrammed flash is 0xFF

  // Second pass: fill data
  baseAddress = 0
  for (const line of lines) {
    const byteCount = parseInt(line.slice(1, 3), 16)
    const address = parseInt(line.slice(3, 7), 16)
    const type = parseInt(line.slice(7, 9), 16)

    if (type === 0x04) {
      baseAddress = parseInt(line.slice(9, 13), 16) << 16
    } else if (type === 0x02) {
      baseAddress = parseInt(line.slice(9, 13), 16) << 4
    } else if (type === 0x00) {
      const fullAddr = baseAddress + address
      const offset = fullAddr - minAddr
      for (let i = 0; i < byteCount; i++) {
        data[offset + i] = parseInt(line.slice(9 + i * 2, 11 + i * 2), 16)
      }
    } else if (type === 0x01) {
      break
    }
  }

  return { data, startAddress: minAddr, endAddress: maxAddr }
}

/**
 * Detect if a file is Intel HEX format by checking the first line.
 */
export function isIntelHex(text) {
  const firstLine = text.trimStart().split(/\r?\n/)[0]
  return firstLine?.startsWith(':') && /^:[0-9A-Fa-f]{10,}$/.test(firstLine)
}
