# WebOLS Changelog

A web-based binary file viewer and ECU tuning tool inspired by WinOLS.

## Features

### Core Hex Viewer
- Classic hex editor layout: offset | hex bytes | ASCII
- Keyboard navigation (arrows, Page Up/Down, Home/End, Ctrl+Home/End)
- Go to offset dialog (Ctrl+G) - supports hex (0x, h suffix) and decimal
- Multiple view modes: HEX, U8, I8, U16, I16, U32, I32
- Endianness toggle (Little Endian / Big Endian)
- Custom scrollbar with position indicator

### Multi-File Support
- Load up to 3 files simultaneously (A, B, C)
- File A (blue), File B (green), File C (orange) color coding
- Switch between viewing individual files
- Diff mode with selectable pairs (A↔B, A↔C, B↔C)
- Diff highlighting: green = increased, red = decreased

### Table System
- Define custom tables with: name, rows, cols, data type, offset
- Table list in sidebar with edit/delete actions
- Heatmap visualization (blue→cyan→green→yellow→red gradient)
- Table viewer with:
  - Switch between files A/B/C
  - Diff view with change statistics
  - Dynamic data type switching (reinterpret same bytes)
  - Endianness toggle
  - Cell tooltips with offset and all file values

### Difference Analysis (Diff Tab)
- Clustered diff regions (not individual bytes)
- Adjustable gap threshold slider (0-512 bytes)
- Shows: offset range, size, region count
- Click to jump to offset
- View as table button for each region

### Value Search (Find Tab)
- Search types: Hex bytes, Text (ASCII), U8/I8/U16/I16/U32/I32
- File selector (search in A, B, or C)
- Respects endianness setting
- Click results to jump to offset
- Up to 500 results

### Auto Map Finder (Auto Tab)
- Dynamic map detection (no predefined sizes)
- Entropy-based filtering (skips random/compressed data)
- Autocorrelation period detection for column width
- Scoring based on:
  - Gradient smoothness
  - Row/column correlation
  - Value distribution
- Detects maps from 4×4 to 40×40
- Preview as table or save to table list
- Results persist across page refresh

### Rev Limiter Finder (Rev Tab)
- Search modes: Auto, Range (Low/Medium/High/Very High), Exact RPM
- Scaling factor detection:
  - Direct RPM (×1)
  - RPM × 0.25, × 0.5, × 0.125
  - RPM / 4, / 8, / 10
- Scoring based on:
  - Hysteresis pairs (100-500 RPM lower value nearby)
  - Multiple occurrences (2-8×)
  - Related values nearby
  - Common RPM values (6000, 6500, 7000, etc.)
  - Round numbers
- Shows scoring reasons for each result
- Results persist across page refresh

### Project Persistence
- Auto-save to localStorage
- Export/Import as JSON (.webols.json)
- File System Access API for automatic file restoration (Chrome/Edge)
- "Grant Access" button when permission needed
- Fallback to regular file input for other browsers

## Tech Stack
- React 18 + Vite
- Tailwind CSS
- IndexedDB for file handle storage
- localStorage for project settings

## File Structure
```
src/
├── App.jsx           # Main app, state management, file handling
├── HexViewer.jsx     # Hex editor component
├── TableViewer.jsx   # Table heatmap viewer
├── TableModal.jsx    # Create/edit table dialog
├── TableList.jsx     # Sidebar table list
├── DiffList.jsx      # Clustered diff regions
├── SearchPanel.jsx   # Value search
├── MapFinder.jsx     # Auto map detection
├── RevLimitFinder.jsx # Rev limiter search
├── fileSystem.js     # File System Access API utilities
├── index.css         # Tailwind imports
└── main.jsx          # React entry point
```

## Keyboard Shortcuts
- `Ctrl+G` - Go to offset
- Arrow keys - Navigate cursor
- Page Up/Down - Scroll by page
- Home/End - Start/end of row
- Ctrl+Home/End - Start/end of file

## Browser Support
- Chrome/Edge: Full support including file restoration
- Firefox/Safari: Works without file restoration feature
