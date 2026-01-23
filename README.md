# WebOLS

A web-based binary file viewer and ECU tuning tool inspired by WinOLS/hexedit.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Features

- **Hex Viewer** - Classic layout with offset, hex, ASCII columns
- **Multi-file Compare** - Load 3 files, diff any pair
- **Table System** - Define maps with heatmap visualization
- **Auto Map Finder** - ML-like detection of calibration tables
- **Rev Limiter Finder** - ECU-specific rev limit detection
- **Value Search** - Find hex, text, or numeric values
- **Project Save** - Auto-save, export/import JSON

## Screenshots

### Hex Viewer with Diff Mode
View and compare binary files with difference highlighting.

### Table Heatmap
Visualize calibration maps with color gradients.

### Auto Detection
Automatically find potential maps and rev limiters.

## Usage

1. **Open files** - Click File A/B/C buttons
2. **Navigate** - Arrow keys, Page Up/Down, Ctrl+G for go-to
3. **Compare** - Select diff mode and file pair
4. **Find maps** - Use Auto tab to detect tables
5. **Search** - Use Find tab for value search
6. **Save** - Project auto-saves to browser

## License

MIT
