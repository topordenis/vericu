import { useState, useEffect, useRef } from 'react'

const DATA_TYPES = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32']

function TableModal({ isOpen, onClose, onSave, editTable = null }) {
  const [name, setName] = useState('')
  const [rows, setRows] = useState('1')
  const [cols, setCols] = useState('1')
  const [dataType, setDataType] = useState('u8')
  const [offset, setOffset] = useState('')
  const nameInputRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      if (editTable) {
        setName(editTable.name)
        setRows(editTable.rows.toString())
        setCols(editTable.cols.toString())
        setDataType(editTable.dataType)
        setOffset(editTable.offset.toString(16).toUpperCase())
      } else {
        setName('')
        setRows('1')
        setCols('1')
        setDataType('u8')
        setOffset('')
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

  const handleSubmit = (e) => {
    e.preventDefault()
    const parsedOffset = parseOffset(offset)
    if (!name.trim() || isNaN(parsedOffset)) return

    onSave({
      id: editTable?.id || Date.now(),
      name: name.trim(),
      rows: Math.max(1, parseInt(rows) || 1),
      cols: Math.max(1, parseInt(cols) || 1),
      dataType,
      offset: parsedOffset,
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
            <label className="block text-gray-400 text-xs mb-1">Offset (hex)</label>
            <input
              type="text"
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              placeholder="e.g. 1000 or 0x1000"
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-gray-200 font-mono text-sm outline-none focus:border-blue-500"
            />
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
