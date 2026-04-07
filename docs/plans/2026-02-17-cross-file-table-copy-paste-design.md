# Cross-File Table Cell Copy/Paste

## Problem

When tuning ECU binaries, you often want to copy specific cell values from one file to another (e.g. take a fuel map region from a known-good tune and paste it into your working file). Currently there's no way to do this — you'd have to manually re-enter values.

## Design

### Clipboard State

New state in `App.jsx`:

```js
clipboard: {
  tableId: string,
  sourceFile: 'A' | 'B' | 'C',
  selection: { startRow, startCol, endRow, endCol },
  values: Uint8Array
}
```

### Copy

1. User selects cells in TableViewer (existing click-drag selection)
2. Clicks Copy button or Ctrl+C
3. App reads the raw bytes for the selected cell range from the current file's Uint8Array
4. Stores in clipboard state: tableId, sourceFile, selection bounds, raw bytes

Byte extraction:
```
for each (row, col) in selection:
  offset = table.offset + (row * table.cols + col) * typeSize
  copy typeSize bytes from fileData[offset..offset+typeSize]
```

### Paste

1. User switches to a different file (same table displayed)
2. Clicks Paste button or Ctrl+V
3. App writes clipboard bytes into the same cell positions in the target file's Uint8Array
4. Triggers state update to re-render

Byte write:
```
for each (row, col) in clipboard.selection:
  offset = table.offset + (row * table.cols + col) * typeSize
  write typeSize bytes from clipboard.values into targetFileData[offset..offset+typeSize]
```

### UI Changes

**TableViewer toolbar:**
- Copy button: enabled when cells are selected
- Paste button: enabled when clipboard has data for current table AND viewing a different file
- Keyboard: Ctrl+C to copy, Ctrl+V to paste
- Feedback: brief flash text "Copied N cells" / "Pasted"

**TableList sidebar:**
- No changes needed — copy/paste operates at the cell level inside TableViewer

### Guards

- Paste disabled if clipboard tableId != current table id
- Paste disabled if viewing same file as clipboard source
- Paste disabled if clipboard is empty

### Out of Scope

- No undo (consistent with existing cell editing)
- No cross-table paste (different table definitions)
- No "paste at different position" — always same row/col
- No confirmation dialog
