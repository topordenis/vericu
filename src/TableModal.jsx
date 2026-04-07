import { useState, useEffect, useRef } from 'react'

const DATA_TYPES = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32']

function TableModal({ isOpen, onClose, onSave, editTable = null, tables = [] }) {
  const [name, setName] = useState('')
  const [rows, setRows] = useState('1')
  const [cols, setCols] = useState('1')
  const [dataType, setDataType] = useState('u8')
  const [offset, setOffset] = useState('')
  const [formula, setFormula] = useState('')
  const [xAxis, setXAxis] = useState('') // Comma-separated values for X axis (columns)
  const [yAxis, setYAxis] = useState('') // Comma-separated values for Y axis (rows)
  const [xAxisTableId, setXAxisTableId] = useState('') // Reference to table for X axis
  const [yAxisTableId, setYAxisTableId] = useState('') // Reference to table for Y axis
  const [endianness, setEndianness] = useState('little') // 'little' or 'big'
  const nameInputRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      if (editTable) {
        setName(editTable.name)
        setRows(editTable.rows.toString())
        setCols(editTable.cols.toString())
        setDataType(editTable.dataType)
        setOffset(editTable.offset.toString(16).toUpperCase())
        setFormula(editTable.formula || '')
        setXAxis(editTable.xAxis?.join(', ') || '')
        setYAxis(editTable.yAxis?.join(', ') || '')
        setXAxisTableId(editTable.xAxisTableId || '')
        setYAxisTableId(editTable.yAxisTableId || '')
        setEndianness(editTable.endianness || 'little')
      } else {
        setName('')
        setRows('1')
        setCols('1')
        setDataType('u8')
        setOffset('')
        setFormula('')
        setXAxis('')
        setYAxis('')
        setXAxisTableId('')
        setYAxisTableId('')
        setEndianness('little')
      }
      setTimeout(() => nameInputRef.current?.focus(), 0)
    }
  }, [isOpen, editTable])

  const parseOffset = (value) => {
    const trimmed = value.trim().toLowerCase()
    if (trimmed.startsWith('0x')) {
      return parseInt(trimmed.slice(2), 16)
    } else if (trimmed.endsWith('h')) {
      return parseInt(trimmed.slice(0, -1), 16)
    }
    return parseInt(trimmed, 16) // Default to hex
  }

  const parseAxisValues = (str, expectedCount) => {
    if (!str.trim()) return null
    const values = str.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n))
    return values.length > 0 ? values : null
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const parsedOffset = parseOffset(offset)
    if (!name.trim() || isNaN(parsedOffset)) return

    const rowCount = Math.max(1, parseInt(rows) || 1)
    const colCount = Math.max(1, parseInt(cols) || 1)

    onSave({
      id: editTable?.id || Date.now().toString(),
      name: name.trim(),
      rows: rowCount,
      cols: colCount,
      dataType,
      offset: parsedOffset,
      formula: formula.trim(),
      xAxis: parseAxisValues(xAxis, colCount),
      yAxis: parseAxisValues(yAxis, rowCount),
      xAxisTableId: xAxisTableId || null,
      yAxisTableId: yAxisTableId || null,
      endianness,
    })
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
      <form onSubmit={handleSubmit} className="bg-gray-800 border border-gray-600 rounded-lg p-4 shadow-xl w-80">
        <div className="text-gray-300 text-sm font-semibold mb-4">
          {editTable ? 'Edit Table' : 'New Table'}
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-gray-400 text-xs mb-1">Name</label>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fuel Map"
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-gray-200 text-sm outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-gray-400 text-xs mb-1">Rows</label>
              <input
                type="number"
                min="1"
                value={rows}
                onChange={(e) => setRows(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-gray-200 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-gray-400 text-xs mb-1">Columns</label>
              <input
                type="number"
                min="1"
                value={cols}
                onChange={(e) => setCols(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-gray-200 text-sm outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">Data Type</label>
            <div className="flex gap-1">
              {DATA_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setDataType(type)}
                  className={`flex-1 px-2 py-1.5 rounded text-xs font-mono transition-colors ${
                    dataType === type
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                >
                  {type.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">Endianness</label>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setEndianness('little')}
                className={`flex-1 px-2 py-1.5 rounded text-xs font-mono transition-colors ${
                  endianness === 'little'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                LE
              </button>
              <button
                type="button"
                onClick={() => setEndianness('big')}
                className={`flex-1 px-2 py-1.5 rounded text-xs font-mono transition-colors ${
                  endianness === 'big'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                BE
              </button>
            </div>
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">Offset (hex)</label>
            <input
              type="text"
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              placeholder="e.g. 1000 or 0x1000"
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-gray-200 font-mono text-sm outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">Formula (optional)</label>
            <input
              type="text"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="e.g. x * 0.375 - 23.625"
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-gray-200 font-mono text-sm outline-none focus:border-blue-500"
            />
            <div className="text-gray-500 text-xs mt-1">Use x for the raw value</div>
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">X Axis (columns)</label>
            <div className="flex gap-1 mb-1">
              <select
                value={xAxisTableId}
                onChange={(e) => {
                  setXAxisTableId(e.target.value)
                  if (e.target.value) setXAxis('')
                }}
                className="flex-1 bg-gray-900 border border-gray-600 rounded-l px-2 py-1 text-gray-200 text-xs outline-none focus:border-blue-500"
              >
                <option value="">Manual input...</option>
                {tables.filter(t => t.id !== editTable?.id).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.rows}×{t.cols})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setXAxisTableId('')
                  const count = parseInt(cols) || 1
                  setXAxis(Array.from({ length: count }, (_, i) => i * 10).join(', '))
                }}
                className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 rounded-r text-xs border border-l-0 border-gray-600"
                title="Generate linear: 0, 10, 20..."
              >
                ×10
              </button>
            </div>
            {!xAxisTableId && (
              <input
                type="text"
                value={xAxis}
                onChange={(e) => setXAxis(e.target.value)}
                placeholder={`e.g. 0, 10, 20, 30... (${cols} values)`}
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-gray-200 font-mono text-sm outline-none focus:border-blue-500"
              />
            )}
            {xAxisTableId && (
              <div className="text-cyan-400 text-xs">📊 Linked to: {tables.find(t => t.id === xAxisTableId)?.name}</div>
            )}
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">Y Axis (rows)</label>
            <div className="flex gap-1 mb-1">
              <select
                value={yAxisTableId}
                onChange={(e) => {
                  setYAxisTableId(e.target.value)
                  if (e.target.value) setYAxis('')
                }}
                className="flex-1 bg-gray-900 border border-gray-600 rounded-l px-2 py-1 text-gray-200 text-xs outline-none focus:border-blue-500"
              >
                <option value="">Manual input...</option>
                {tables.filter(t => t.id !== editTable?.id).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.rows}×{t.cols})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setYAxisTableId('')
                  const count = parseInt(rows) || 1
                  setYAxis(Array.from({ length: count }, (_, i) => (i + 1) * 500).join(', '))
                }}
                className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 rounded-r text-xs border border-l-0 border-gray-600"
                title="Generate RPM-style: 500, 1000, 1500..."
              >
                RPM
              </button>
            </div>
            {!yAxisTableId && (
              <input
                type="text"
                value={yAxis}
                onChange={(e) => setYAxis(e.target.value)}
                placeholder={`e.g. 500, 1000, 1500... (${rows} values)`}
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-gray-200 font-mono text-sm outline-none focus:border-blue-500"
              />
            )}
            {yAxisTableId && (
              <div className="text-cyan-400 text-xs">📊 Linked to: {tables.find(t => t.id === yAxisTableId)?.name}</div>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            type="submit"
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm"
          >
            {editTable ? 'Save' : 'Create'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-gray-600 hover:bg-gray-500 text-white px-3 py-1.5 rounded text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

export default TableModal
