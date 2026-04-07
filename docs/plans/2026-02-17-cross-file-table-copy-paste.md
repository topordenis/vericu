# Cross-File Table Cell Copy/Paste Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable copying a selected region of table cells from one ECU binary file and pasting into the same position in another file.

**Architecture:** Add clipboard state to App.jsx, pass it down to TableViewer. Augment existing copy flow to store raw bytes alongside the text clipboard. Add paste handler that writes bytes back into target file's Uint8Array.

**Tech Stack:** React (hooks), Uint8Array binary manipulation

---

### Task 1: Add clipboard state to App.jsx

**Files:**
- Modify: `src/App.jsx:129` (state declarations area)
- Modify: `src/App.jsx:1137-1162` (TableViewer props)

**Step 1: Add clipboard state**

After line 133 (`const [viewingTable, setViewingTable] = useState(null)`), add:

```jsx
const [clipboard, setClipboard] = useState(null) // { tableId, sourceFile, selection, bytes }
```

**Step 2: Pass clipboard props to TableViewer**

Update the TableViewer usage (around line 1137) to pass clipboard state and handlers:

```jsx
<TableViewer
  table={viewingTable}
  dataA={fileDataA}
  dataB={fileDataB}
  dataC={fileDataC}
  formula={formula}
  tables={tables}
  endianness={endianness}
  clipboard={clipboard}
  onSetClipboard={setClipboard}
  onClose={() => {
    setViewingTable(null)
    setSelectedTableId(null)
  }}
  onUpdateTable={...}
  onUpdateBinary={...}
/>
```

**Step 3: Verify app still renders**

Run: `npm run dev` and confirm no errors in console.

**Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "Add clipboard state for cross-file table copy/paste"
```

---

### Task 2: Implement raw byte copy in TableViewer

**Files:**
- Modify: `src/TableViewer.jsx:17` (add clipboard/onSetClipboard to props)
- Modify: `src/TableViewer.jsx:530-553` (copySelection function)
- Modify: `src/TableViewer.jsx:556-564` (handleKeyDown)

**Step 1: Add props**

Update the component signature (line 17) to accept `clipboard` and `onSetClipboard`:

```jsx
function TableViewer({ table, dataA, dataB, dataC, formula: globalFormula = '', onClose, onUpdateTable, onUpdateBinary, tables = [], endianness: globalEndianness = 'little', clipboard, onSetClipboard }) {
```

**Step 2: Modify copySelection to also store raw bytes**

Replace the existing `copySelection` function (lines 530-553) to additionally capture raw bytes:

```jsx
const copySelection = useCallback(async () => {
  const bounds = getSelectionBounds()
  if (!bounds) return

  // Copy formatted text to system clipboard (existing behavior)
  const lines = []
  for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
    const rowValues = []
    for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
      const val = currentValues[r]?.[c]
      if (val !== null && val !== undefined) {
        rowValues.push(formula ? formatDisplayValue(val) : val.toString())
      } else {
        rowValues.push('??')
      }
    }
    lines.push(rowValues.join('\t'))
  }
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
  } catch (err) {
    console.error('Failed to copy:', err)
  }

  // Store raw bytes in internal clipboard for cross-file paste
  if (onSetClipboard && !isDiffMode) {
    const size = TYPE_SIZES[displayDataType]
    const isLE = tableEndianness === 'little'
    const fileMap = { A: dataA, B: dataB, C: dataC }
    const sourceData = fileMap[viewMode]
    if (!sourceData) return

    const rows = bounds.maxRow - bounds.minRow + 1
    const cols = bounds.maxCol - bounds.minCol + 1
    const bytes = new Uint8Array(rows * cols * size)
    let idx = 0

    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
      for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
        const offset = liveOffset + (r * liveCols + c) * size
        for (let b = 0; b < size; b++) {
          bytes[idx++] = sourceData[offset + b] ?? 0
        }
      }
    }

    onSetClipboard({
      tableId: table.id,
      sourceFile: viewMode,
      selection: { startRow: bounds.minRow, startCol: bounds.minCol, endRow: bounds.maxRow, endCol: bounds.maxCol },
      bytes,
    })
  }
}, [getSelectionBounds, currentValues, formula, formatDisplayValue, onSetClipboard, isDiffMode, displayDataType, tableEndianness, viewMode, dataA, dataB, dataC, liveOffset, liveCols, table.id])
```

**Step 3: Verify copy still works**

Open a table, select cells, Ctrl+C — check system clipboard has text values. Internal clipboard state should also be set (verify via React DevTools or console log).

**Step 4: Commit**

```bash
git add src/TableViewer.jsx
git commit -m "Store raw bytes in clipboard on table cell copy"
```

---

### Task 3: Implement paste handler in TableViewer

**Files:**
- Modify: `src/TableViewer.jsx` (add pasteSelection function after copySelection)
- Modify: `src/TableViewer.jsx:556-564` (handleKeyDown — add Ctrl+V)

**Step 1: Add canPaste computed value and pasteSelection function**

After the `copySelection` function, add:

```jsx
const canPaste = clipboard
  && clipboard.tableId === table.id
  && clipboard.sourceFile !== viewMode
  && !isDiffMode
  && viewMode !== 'diff'

const pasteSelection = useCallback(() => {
  if (!canPaste || !onUpdateBinary) return

  const fileMap = { A: dataA, B: dataB, C: dataC }
  const targetData = fileMap[viewMode]
  if (!targetData) return

  const size = TYPE_SIZES[displayDataType]
  const { startRow, startCol, endRow, endCol } = clipboard.selection
  const newData = new Uint8Array(targetData)
  let idx = 0

  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const offset = liveOffset + (r * liveCols + c) * size
      for (let b = 0; b < size; b++) {
        if (offset + b < newData.length) {
          newData[offset + b] = clipboard.bytes[idx]
        }
        idx++
      }
    }
  }

  onUpdateBinary(viewMode, newData)
}, [canPaste, clipboard, viewMode, dataA, dataB, dataC, displayDataType, liveOffset, liveCols, onUpdateBinary])
```

**Step 2: Add Ctrl+V to handleKeyDown**

Update the `handleKeyDown` (lines 556-564) to handle paste:

```jsx
const handleKeyDown = useCallback((e) => {
  if (e.key === 'c' && e.ctrlKey && selectionStart) {
    e.preventDefault()
    copySelection()
  } else if (e.key === 'v' && e.ctrlKey) {
    e.preventDefault()
    pasteSelection()
  } else if (e.key === 'Escape') {
    setSelectionStart(null)
    setSelectionEnd(null)
  }
}, [selectionStart, copySelection, pasteSelection])
```

**Step 3: Verify paste works**

1. Open file A, view a table, select cells, copy
2. Switch to file B (same table), Ctrl+V
3. Values should update to match file A's values

**Step 4: Commit**

```bash
git add src/TableViewer.jsx
git commit -m "Add paste handler for cross-file table cell paste"
```

---

### Task 4: Add Paste button to the UI

**Files:**
- Modify: `src/TableViewer.jsx:918-949` (selection info bar — add paste button)
- Modify: `src/TableViewer.jsx:990-1001` (context menu — add paste option)

**Step 1: Add Paste button to the selection info bar**

In the selection info bar (around line 918), add a Paste button next to the existing Copy button. Also add a clipboard indicator when paste is available:

```jsx
{/* Selection info bar */}
{(selectionStart && selectionEnd || canPaste) && (
  <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 shadow-xl flex items-center gap-3 text-sm z-50">
    {selectionStart && selectionEnd && (
      <>
        <span className="text-gray-400">
          {(() => {
            const bounds = getSelectionBounds()
            if (!bounds) return ''
            const rows = bounds.maxRow - bounds.minRow + 1
            const cols = bounds.maxCol - bounds.minCol + 1
            return `${rows}×${cols} cells`
          })()}
        </span>
        <button
          onClick={copySelection}
          className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-0.5 rounded text-xs flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy
        </button>
        <span className="text-gray-600 text-xs">Ctrl+C</span>
      </>
    )}
    {canPaste && (
      <>
        {selectionStart && selectionEnd && <div className="w-px h-4 bg-gray-600" />}
        <button
          onClick={pasteSelection}
          className="bg-green-600 hover:bg-green-500 text-white px-2 py-0.5 rounded text-xs flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          Paste from {clipboard.sourceFile}
        </button>
        <span className="text-gray-600 text-xs">Ctrl+V</span>
      </>
    )}
    {selectionStart && selectionEnd && (
      <button
        onClick={() => { setSelectionStart(null); setSelectionEnd(null) }}
        className="text-gray-500 hover:text-gray-300"
        title="Clear selection (Esc)"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    )}
  </div>
)}
```

**Step 2: Add Paste to context menu**

After the existing "Copy" item in the context menu (around line 990), add:

```jsx
{canPaste && (
  <button
    onClick={() => {
      pasteSelection()
      setContextMenu(null)
    }}
    className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
  >
    <span className="text-green-400">📋</span>
    Paste from File {clipboard.sourceFile}
  </button>
)}
```

**Step 3: Verify UI**

1. Select cells → Copy button appears + copies
2. Switch file → Paste button appears with source file label
3. Click Paste → values update
4. Right-click context menu shows Paste option

**Step 4: Commit**

```bash
git add src/TableViewer.jsx
git commit -m "Add paste button to table viewer toolbar and context menu"
```

---

### Task 5: Add copy button to TableList sidebar

**Files:**
- Modify: `src/TableList.jsx:1` (add props)
- Modify: `src/App.jsx:956-967` (pass new props to TableList)

**Step 1: Add onCopyTable callback to TableList**

Update `TableList` to accept and render a copy-to-file button. Add `onCopyTable`, `clipboard`, `fileDataA`, `fileDataB`, `fileDataC`, `compareMode` props:

```jsx
function TableList({ tables, onSelect, onEdit, onDelete, onGoToOffset, selectedId, onCopyTable, clipboard, fileDataA, fileDataB, fileDataC, compareMode }) {
```

For each table row, add a copy icon button that copies the ENTIRE table from the currently viewed file to another:

```jsx
{onCopyTable && (
  <button
    onClick={(e) => {
      e.stopPropagation()
      onCopyTable(table)
    }}
    className="text-gray-500 hover:text-green-400 p-1"
    title="Copy entire table to clipboard"
  >
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  </button>
)}
```

**Step 2: Add handleCopyWholeTable in App.jsx and pass to TableList**

In App.jsx, add a handler that copies the entire table's bytes:

```jsx
const handleCopyWholeTable = useCallback((table) => {
  const fileMap = { A: fileDataA, B: fileDataB, C: fileDataC }
  // Use compareMode to determine source file (only A/B/C, not diff)
  const sourceKey = compareMode === 'diff' ? 'A' : compareMode
  const sourceData = fileMap[sourceKey]
  if (!sourceData) return

  const size = TYPE_SIZES_MAP[table.dataType]
  const totalBytes = table.rows * table.cols * size
  const bytes = new Uint8Array(totalBytes)

  for (let i = 0; i < totalBytes; i++) {
    bytes[i] = sourceData[table.offset + i] ?? 0
  }

  setClipboard({
    tableId: table.id,
    sourceFile: sourceKey,
    selection: { startRow: 0, startCol: 0, endRow: table.rows - 1, endCol: table.cols - 1 },
    bytes,
  })
}, [fileDataA, fileDataB, fileDataC, compareMode])
```

Note: We need the TYPE_SIZES map in App.jsx. Add at the top:

```jsx
const TYPE_SIZES_MAP = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4 }
```

Pass to TableList:

```jsx
<TableList
  tables={tables}
  selectedId={selectedTableId}
  onSelect={handleSelectTable}
  onEdit={handleEditTable}
  onDelete={handleDeleteTable}
  onCopyTable={handleCopyWholeTable}
  compareMode={compareMode}
  onGoToOffset={(offset) => {
    setViewingTable(null)
    setSelectedTableId(null)
    hexViewerRef.current?.goToOffset(offset)
  }}
/>
```

**Step 3: Verify**

1. Load two files, create a table
2. Click copy icon in sidebar → clipboard stores entire table bytes
3. Open table, switch to other file, paste → entire table values transfer

**Step 4: Commit**

```bash
git add src/App.jsx src/TableList.jsx
git commit -m "Add whole-table copy button to sidebar table list"
```
