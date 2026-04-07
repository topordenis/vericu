// A2L (ASAP2) file parser for WebOLS
// Parses CHARACTERISTIC (MAP/CURVE/VALUE), RECORD_LAYOUT, COMPU_METHOD, AXIS_PTS
// and converts them into WebOLS table definitions

const A2L_TYPE_MAP = {
  UBYTE: 'u8',
  SBYTE: 'i8',
  UWORD: 'u16',
  SWORD: 'i16',
  ULONG: 'u32',
  SLONG: 'i32',
  FLOAT32_IEEE: 'u32', // best we can do without float support
}

const TYPE_SIZES = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4 }

/**
 * Tokenizer that handles the A2L /begin.../end block structure.
 * Returns an array of tokens: strings, numbers, and block markers.
 */
function tokenize(text) {
  const tokens = []
  let i = 0
  const len = text.length

  while (i < len) {
    // skip whitespace
    if (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r') {
      i++
      continue
    }

    // line comment
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < len && text[i] !== '\n') i++
      continue
    }

    // block comment
    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2
      while (i < len - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }

    // quoted string
    if (text[i] === '"') {
      i++
      let s = ''
      while (i < len && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < len) {
          s += text[i + 1]
          i += 2
        } else {
          s += text[i]
          i++
        }
      }
      i++ // skip closing quote
      tokens.push(s)
      continue
    }

    // /begin or /end
    if (text[i] === '/') {
      i++
      let kw = ''
      while (i < len && text[i] !== ' ' && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') {
        kw += text[i]
        i++
      }
      tokens.push('/' + kw)
      continue
    }

    // word or number
    let word = ''
    while (i < len && text[i] !== ' ' && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r' && text[i] !== '"') {
      word += text[i]
      i++
    }
    if (word) tokens.push(word)
  }

  return tokens
}

/**
 * Parse a block from tokens starting at position i (after /begin TYPE).
 * Returns { type, name, tokens: [...innerTokens], children: [...subBlocks] }
 */
function parseBlock(tokens, i) {
  const type = tokens[i]
  const name = tokens[i + 1]
  i += 2

  const block = { type, name, tokens: [], children: [] }

  while (i < tokens.length) {
    if (tokens[i] === '/end') {
      i += 2 // skip /end TYPE
      break
    }
    if (tokens[i] === '/begin') {
      i++ // skip /begin
      const child = parseBlock(tokens, i)
      block.children.push(child)
      i = child._endIdx
      continue
    }
    block.tokens.push(tokens[i])
    i++
  }

  block._endIdx = i
  return block
}

/**
 * Parse all top-level and nested blocks from A2L text.
 */
function parseA2L(text) {
  const tokens = tokenize(text)

  const blocks = {
    RECORD_LAYOUT: {},
    COMPU_METHOD: {},
    AXIS_PTS: {},
    CHARACTERISTIC: [],
    MOD_COMMON: null,
    MEMORY_SEGMENT: [],
  }

  // Flatten all blocks by walking the full tree
  function collectBlocks(tokenArr, start) {
    let i = start || 0
    while (i < tokenArr.length) {
      if (tokenArr[i] === '/begin') {
        i++
        const block = parseBlock(tokenArr, i)
        i = block._endIdx

        switch (block.type) {
          case 'RECORD_LAYOUT':
            blocks.RECORD_LAYOUT[block.name] = parseRecordLayout(block)
            break
          case 'COMPU_METHOD':
            blocks.COMPU_METHOD[block.name] = parseCompuMethod(block)
            break
          case 'AXIS_PTS':
            blocks.AXIS_PTS[block.name] = parseAxisPts(block)
            break
          case 'CHARACTERISTIC':
            blocks.CHARACTERISTIC.push(parseCharacteristic(block))
            break
          case 'MOD_COMMON':
            blocks.MOD_COMMON = parseModCommon(block)
            break
          case 'MEMORY_SEGMENT':
            blocks.MEMORY_SEGMENT.push(parseMemorySegment(block))
            break
          default:
            // recurse into children for nested blocks (PROJECT > MODULE > ...)
            if (block.children.length > 0) {
              // re-process children by reconstructing tokens
              for (const child of block.children) {
                processChild(child)
              }
            }
            break
        }
      } else {
        i++
      }
    }
  }

  function processChild(block) {
    switch (block.type) {
      case 'RECORD_LAYOUT':
        blocks.RECORD_LAYOUT[block.name] = parseRecordLayout(block)
        break
      case 'COMPU_METHOD':
        blocks.COMPU_METHOD[block.name] = parseCompuMethod(block)
        break
      case 'AXIS_PTS':
        blocks.AXIS_PTS[block.name] = parseAxisPts(block)
        break
      case 'CHARACTERISTIC':
        blocks.CHARACTERISTIC.push(parseCharacteristic(block))
        break
      case 'MOD_COMMON':
        blocks.MOD_COMMON = parseModCommon(block)
        break
      case 'MEMORY_SEGMENT':
        blocks.MEMORY_SEGMENT.push(parseMemorySegment(block))
        break
      default:
        break
    }
    for (const child of block.children) {
      processChild(child)
    }
  }

  collectBlocks(tokens, 0)
  return blocks
}

function parseNum(s) {
  if (typeof s === 'number') return s
  if (typeof s !== 'string') return NaN
  s = s.trim()
  if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s, 16)
  return parseFloat(s)
}

function parseRecordLayout(block) {
  const toks = block.tokens
  // FNC_VALUES position dataType direction addressing
  // or AXIS_PTS_X position dataType direction addressing
  let dataType = null
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === 'FNC_VALUES' || toks[i] === 'AXIS_PTS_X') {
      dataType = toks[i + 2] // UBYTE, UWORD, etc.
      break
    }
  }
  return { dataType }
}

function parseCompuMethod(block) {
  const toks = block.tokens
  // name is block.name
  // tokens: description, conversionType, format, unit, ...
  // For RAT_FUNC: COEFFS a b c d e f
  const result = { factor: 1, offset: 0, unit: '' }

  // description is first token (already consumed as part of block parsing)
  // conversionType, format, unit come next in the characteristic's ref
  // But in COMPU_METHOD block: description, type, format, unit
  // toks[0] = description (string), toks[1] = RAT_FUNC, toks[2] = format, toks[3] = unit
  if (toks.length >= 4) {
    result.unit = toks[2] || ''
  }

  const coeffIdx = toks.indexOf('COEFFS')
  if (coeffIdx !== -1) {
    const a = parseNum(toks[coeffIdx + 1])
    const b = parseNum(toks[coeffIdx + 2])
    const c = parseNum(toks[coeffIdx + 3])
    const d = parseNum(toks[coeffIdx + 4])
    const e = parseNum(toks[coeffIdx + 5])
    const f = parseNum(toks[coeffIdx + 6])
    // RAT_FUNC COEFFS define: INTERNAL = (a*PHYS² + b*PHYS + c) / (d*PHYS² + e*PHYS + f)
    // We need the inverse: PHYSICAL = f(INTERNAL)
    // When a=0, d=0, e=0: INT = (b*PHYS + c) / f
    //   => PHYS = (INT * f - c) / b = INT * (f/b) - (c/b)
    if (b !== 0) {
      result.factor = f / b
      result.offset = -c / b
    }
  }

  return result
}

function parseAxisPts(block) {
  const toks = block.tokens
  // description, address, inputQuantity, recordLayout, maxDiff, compuMethod, maxAxisPoints, lowerLimit, upperLimit
  return {
    description: toks[0] || '',
    address: parseNum(toks[1]),
    inputQuantity: toks[2],
    recordLayout: toks[3],
    compuMethod: toks[5],
    maxAxisPoints: parseNum(toks[6]),
    lowerLimit: parseNum(toks[7]),
    upperLimit: parseNum(toks[8]),
  }
}

function parseCharacteristic(block) {
  const toks = block.tokens
  // description, type, address, recordLayout, maxDiff, compuMethod, lowerLimit, upperLimit
  const charType = toks[1] // VALUE, CURVE, MAP
  const result = {
    name: block.name,
    description: toks[0] || '',
    type: charType,
    address: parseNum(toks[2]),
    recordLayout: toks[3],
    compuMethod: toks[5],
    lowerLimit: parseNum(toks[6]),
    upperLimit: parseNum(toks[7]),
    axisDescriptions: [],
  }

  for (const child of block.children) {
    if (child.type === 'AXIS_DESCR') {
      result.axisDescriptions.push(parseAxisDescr(child))
    }
  }

  return result
}

function parseAxisDescr(block) {
  const toks = block.tokens
  // type (STD_AXIS/COM_AXIS/FIX_AXIS), inputQuantity, compuMethod, maxAxisPoints, lowerLimit, upperLimit
  const result = {
    type: block.name, // STD_AXIS, COM_AXIS, FIX_AXIS
    inputQuantity: toks[0],
    compuMethod: toks[1],
    maxAxisPoints: parseNum(toks[2]),
    lowerLimit: parseNum(toks[3]),
    upperLimit: parseNum(toks[4]),
    axisPtsRef: null,
    fixAxisParDist: null,
  }

  // Look for AXIS_PTS_REF or FIX_AXIS_PAR_DIST in remaining tokens
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === 'AXIS_PTS_REF') {
      result.axisPtsRef = toks[i + 1]
    }
    if (toks[i] === 'FIX_AXIS_PAR_DIST') {
      result.fixAxisParDist = {
        offset: parseNum(toks[i + 1]),
        shift: parseNum(toks[i + 2]),
        count: parseNum(toks[i + 3]),
      }
    }
  }

  return result
}

function parseModCommon(block) {
  const toks = block.tokens
  const result = { byteOrder: 'big' } // default

  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === 'BYTE_ORDER') {
      result.byteOrder = toks[i + 1] === 'MSB_FIRST' ? 'big' : 'little'
    }
  }

  return result
}

function parseMemorySegment(block) {
  const toks = block.tokens
  // name, description, type, memType, attribute, address, size, ...
  return {
    description: toks[0] || '',
    segType: toks[1],
    memType: toks[2],
    attribute: toks[3],
    address: parseNum(toks[4]),
    size: parseNum(toks[5]),
  }
}

/**
 * Generate axis labels from an AXIS_DESCR.
 * For COM_AXIS: reads breakpoint values from binary data at the AXIS_PTS address.
 * For FIX_AXIS: generates values from FIX_AXIS_PAR_DIST parameters.
 */
function resolveAxisLabels(axisDescr, a2l, fileData, baseOffset) {
  if (!axisDescr) return null

  if (axisDescr.type === 'FIX_AXIS' && axisDescr.fixAxisParDist) {
    const { offset, shift, count } = axisDescr.fixAxisParDist
    const labels = []
    for (let i = 0; i < count; i++) {
      labels.push(offset + i * shift)
    }
    // Apply compu method
    const cm = a2l.COMPU_METHOD[axisDescr.compuMethod]
    if (cm && (cm.factor !== 1 || cm.offset !== 0)) {
      return labels.map(v => Math.round((v * cm.factor + cm.offset) * 1000) / 1000)
    }
    return labels
  }

  if (axisDescr.type === 'COM_AXIS' && axisDescr.axisPtsRef) {
    const axisPts = a2l.AXIS_PTS[axisDescr.axisPtsRef]
    if (!axisPts || !fileData) return null

    const layout = a2l.RECORD_LAYOUT[axisPts.recordLayout]
    if (!layout) return null

    const a2lType = layout.dataType
    const webType = A2L_TYPE_MAP[a2lType]
    if (!webType) return null

    const typeSize = TYPE_SIZES[webType]
    const count = axisDescr.maxAxisPoints
    const addr = axisPts.address - baseOffset
    const isBigEndian = a2l.MOD_COMMON?.byteOrder === 'big'

    const labels = []
    for (let i = 0; i < count; i++) {
      const off = addr + i * typeSize
      if (off < 0 || off + typeSize > fileData.length) break
      labels.push(readValue(fileData, off, typeSize, webType.startsWith('i'), isBigEndian))
    }

    // Apply compu method for axis
    const cm = a2l.COMPU_METHOD[axisPts.compuMethod]
    if (cm && (cm.factor !== 1 || cm.offset !== 0)) {
      return labels.map(v => Math.round((v * cm.factor + cm.offset) * 1000) / 1000)
    }
    return labels
  }

  return null
}

function readValue(data, offset, size, signed, bigEndian) {
  let value = 0
  for (let i = 0; i < size; i++) {
    if (bigEndian) {
      value = (value << 8) | (data[offset + i] || 0)
    } else {
      value |= (data[offset + i] || 0) << (i * 8)
    }
  }
  // Handle unsigned overflow for 32-bit
  if (size === 4 && !signed) {
    value = value >>> 0
  }
  if (signed && value >= (1 << (size * 8 - 1))) {
    value -= 1 << (size * 8)
  }
  return value
}

/**
 * Build a formula string from COMPU_METHOD coefficients.
 * Returns empty string if it's identity (factor=1, offset=0).
 */
function buildFormula(compuMethod) {
  if (!compuMethod) return ''
  const { factor, offset } = compuMethod
  if (factor === 1 && offset === 0) return ''
  if (offset === 0) return `x * ${factor}`
  if (factor === 1) return offset < 0 ? `x - ${-offset}` : `x + ${offset}`
  return offset < 0 ? `x * ${factor} - ${-offset}` : `x * ${factor} + ${offset}`
}

/**
 * Detect the base address from MEMORY_SEGMENT blocks.
 * Uses the DATA segment (calibration area).
 */
function detectBaseAddress(a2l) {
  for (const seg of a2l.MEMORY_SEGMENT) {
    if (seg.segType === 'DATA') return seg.address
  }
  // fallback: use the lowest address segment
  if (a2l.MEMORY_SEGMENT.length > 0) {
    return Math.min(...a2l.MEMORY_SEGMENT.map(s => s.address))
  }
  return 0
}

/**
 * Main export: parse A2L text and convert to WebOLS table definitions.
 *
 * @param {string} text - Raw A2L file content
 * @param {Uint8Array} fileData - Binary file data (for reading axis breakpoints)
 * @param {object} options - { baseAddress?: number }
 * @returns {{ tables: Array, summary: { maps: number, curves: number, values: number }, baseAddress: number, endianness: string }}
 */
export function parseA2LToTables(text, fileData, options = {}) {
  // Strip wrapping quotes (some A2L exporters wrap the entire file in quotes)
  text = text.trim()
  if (text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1)
  }
  // Unescape any escaped quotes left from the wrapping
  text = text.replace(/\\"/g, '"')

  const a2l = parseA2L(text)

  const baseAddress = options.baseAddress ?? detectBaseAddress(a2l)
  const endianness = a2l.MOD_COMMON?.byteOrder || 'big'

  const tables = []
  let maps = 0, curves = 0, values = 0

  for (const char of a2l.CHARACTERISTIC) {
    const layout = a2l.RECORD_LAYOUT[char.recordLayout]
    if (!layout || !layout.dataType) continue

    const webType = A2L_TYPE_MAP[layout.dataType]
    if (!webType) continue

    const fileOffset = char.address - baseAddress
    if (fileOffset < 0) continue

    const cm = a2l.COMPU_METHOD[char.compuMethod]
    const formula = buildFormula(cm)

    const table = {
      id: `a2l_${char.name}_${Date.now()}`,
      name: char.name,
      description: char.description,
      dataType: webType,
      offset: fileOffset,
      formula,
      endianness,
      source: 'a2l',
    }

    if (char.type === 'MAP' && char.axisDescriptions.length >= 2) {
      const xAxis = char.axisDescriptions[0] // first axis = X (columns)
      const yAxis = char.axisDescriptions[1] // second axis = Y (rows)
      table.rows = yAxis.maxAxisPoints
      table.cols = xAxis.maxAxisPoints
      table.xAxis = resolveAxisLabels(xAxis, a2l, fileData, baseAddress)
      table.yAxis = resolveAxisLabels(yAxis, a2l, fileData, baseAddress)
      maps++
    } else if (char.type === 'CURVE' && char.axisDescriptions.length >= 1) {
      const xAxis = char.axisDescriptions[0]
      table.rows = 1
      table.cols = xAxis.maxAxisPoints
      table.xAxis = resolveAxisLabels(xAxis, a2l, fileData, baseAddress)
      table.yAxis = null
      curves++
    } else if (char.type === 'VALUE') {
      table.rows = 1
      table.cols = 1
      table.xAxis = null
      table.yAxis = null
      values++
    } else {
      continue
    }

    tables.push(table)
  }

  return {
    tables,
    summary: { maps, curves, values, total: maps + curves + values },
    baseAddress,
    endianness,
  }
}

/**
 * Merge A2L tables into existing tables array.
 * Skips tables that have the same offset as an existing table.
 */
export function mergeA2LTables(existingTables, a2lTables) {
  const existingOffsets = new Set(existingTables.map(t => t.offset))
  const newTables = a2lTables.filter(t => !existingOffsets.has(t.offset))
  return [...existingTables, ...newTables]
}
