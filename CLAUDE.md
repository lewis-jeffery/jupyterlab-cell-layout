# JupyterLab Cell Layout Extension - Technical Specification

> **Document status (2026-04-26):** This is the original design specification, annotated with the choices and deviations that landed during implementation. Sections marked _Implemented as:_ describe what actually shipped; sections marked _Deferred:_ are out of v1 scope. Phases 1, 2, and 3 are delivered; Phase 4 has not started. See `TASKS.md` for the live task ledger.

## Project Overview

### Purpose
Create a JupyterLab extension that enables drag-and-drop positioning and resizing of notebook cells to create summary views of engineering design documents. Cells can toggle between compact "summary mode" for overview documentation and full "edit mode" for detailed work.

### Primary Use Case
Engineering design documentation where:
- Summary information is visible at a glance in arranged layouts
- Detailed calculations/code are accessible when needed
- Documents can be exported to PDF maintaining the summary layout
- Standard JupyterLab functionality remains unaffected

## Implementation Status (added 2026-04-26)

| Phase | Spec scope | Status | Notes |
| --- | --- | --- | --- |
| 1 | Core infrastructure, mode toggle, metadata persistence, basic summary | ✅ Delivered | All FR1, FR3, FR4 acceptance criteria met. |
| 2 | Drag, resize, z-index, A/B routing, grid snap | ✅ Delivered | A/B override UI deferred (see FR3 below). |
| 3 | PDF export, polish, docs | ✅ Core delivered | Multi-page canvas + page-aware PDF export with searchable text overlay + clickable link annotations. Cover sheet + summary-mode ToC deferred. |
| 4 | Templates, bulk ops, advanced keyboard | 🟡 Partial | Smart alignment guides shipped (was on the Phase 4 backlog). Templates, bulk ops, full keyboard nav not started. Spec's "grid snapping" item already shipped in Phase 2. |

**Deferred or known-limitation items (kept on the task list):**
- **#26** PDF cover sheet (title page + optional ToC).
- **#27** Summary-mode ToC sidebar.
- Vector-text PDF (rather than bitmap+invisible-text) — the searchable text overlay covers the main pain point but vector PDF would be smaller and produce sharper text.
- "Delete a specific page" command (currently only the last page can be removed).

## Core Requirements

### Functional Requirements

#### FR1: Dual-Mode Cell System
- **Summary Mode**: Fixed position, custom size, shows truncated content
- **Edit Mode**: Standard JupyterLab behavior, full content editing
- **Toggle**: Keyboard shortcut (Ctrl+Shift+T) to switch between modes
- **Visual Indicator**: Clear indication of which mode each cell is in

_Implemented as:_ The toggle is **notebook-wide**, not per-cell. The original spec was ambiguous; resolving the ambiguity to a single notebook-level mode avoids two coordinate systems (flow vs. absolute) coexisting on the same canvas. The per-cell `mode` field is retained but reinterpreted as "include this cell on the layout canvas when the notebook is in summary mode." A separate per-cell affordance (`Ctrl+Shift+E` / command palette) toggles inclusion. A toolbar button labelled "Edit mode" / "Summary mode" indicates current state.

#### FR2: Cell Layout Management
- **Drag**: Move input and output cells to arbitrary positions in summary mode
- **Resize**: Custom width/height for each cell in summary mode
- **Output Cell Structure**: Each code cell supports up to two independent output cells
  - Output Cell A: Typically for text/tabular data
  - Output Cell B: Typically for graphics/visualizations
  - Both cells independently draggable and resizable
- **Snap**: Optional grid snapping for alignment
- **Z-Index**: Layer management for overlapping cells
- **Bounds**: Keep cells within viewport boundaries

_Implemented as:_
- **Page-oriented canvas** (added during design): the layout canvas is a vertical stack of physical pages (A4 or A3, portrait or landscape, 1–20 pages) rather than an unbounded viewport. Coordinates are stored in **millimetres** so they round-trip cleanly through PDF export. Pages auto-grow when a cell is dragged beyond the current canvas; user removes pages manually via the page-count toolbar button (shift-click or `Ctrl+Shift+[`). A 5 mm grid snap is on by default; user-adjustable via JL settings.
- **Output A/B routing rule** (resolved ambiguity): text-ish mimetypes (`stream`, `text/plain`, `text/html`, errors/tracebacks) → slot A; graphics mimetypes (`image/png`, `image/jpeg`, `image/svg+xml`, plotly, vega-lite, jupyter widget views) → slot B. Errors always route to A. Within each slot, output items appear in emission order.
- **Z-index** is managed at the cell level — clicking any of a cell's slots (input or either output) raises the whole cell group to the top of the stack.
- **Drag/resize lock during execution**: while a kernel is producing output for a cell, that cell's drag and resize handles are disabled (output content continues to stream and re-truncate live).
- **Markdown / raw cells** participate in the layout as input-only (no output slots).

_Deferred:_ user-facing override UI for A/B slot routing (FR3 "Override" item). Default routing is the only behaviour in v1 — revisit if users hit a real swap-the-slots scenario in practice.

#### FR3: Content Truncation and Output Handling
- **Input Cells**: Show first N lines with "..." indicator for more content
- **Output Cell A**: Typically text/tabular output, truncate with line count control
- **Output Cell B**: Typically graphics/plots, scale and fit within defined area
- **Configurable**: Per-cell visible line count and maximum dimensions
- **Preservation**: Maintain syntax highlighting, formatting, and image quality
- **Mixed Output**: System intelligently routes text to Cell A, graphics to Cell B
- **Override**: User can manually select which output goes to which cell

_Implemented as:_
- **Code inputs** show their full source clipped by the cell's height (`overflow: hidden`); user resizes the cell to see more lines. The `visible_lines` schema field is retained for back-compat but ignored at render time.
- **Markdown inputs** render via JupyterLab's `IRenderMimeRegistry` so headings, lists, links, code spans, math (MathJax), and `<img>` tags resolve correctly through the notebook's URL resolver.
- **Auto-fit on first render**: when a slot first renders an image, the slot resizes to match the image's natural dimensions (capped at 200 × 280 mm). After the first fit or any manual resize, the slot's `auto_fit` flag flips to false and the saved size sticks.
- **Empty output slots are suppressed**: a code cell with no output for a slot renders no slot box; metadata is preserved so the slot reappears at its saved position when the cell next produces output.
- Slots use `object-fit: contain` so dragging the cell's resize handles scales an image inside while preserving aspect ratio.
- Output `enabled: false` removes a slot from the canvas entirely (no placeholder).

#### FR4: Persistent Storage
- **Metadata**: Store layout data in notebook metadata
- **Compatibility**: Zero impact on standard JupyterLab installations
- **Version Control**: Layout changes should diff cleanly in git

_Implemented as:_ All layout state lives in `notebook.metadata.cell_layout`. Standard JupyterLab installs see this as opaque JSON metadata and ignore it. The schema includes a `version` field for future migrations.

#### FR5: PDF Export
- **Layout Preservation**: Summary mode layout translates to PDF structure
- **Document Flow**: Logical reading order despite visual positioning
- **Page Handling**: Intelligent page breaks and sizing
- **Quality**: Professional document appearance

_Implemented as:_
- **Bitmap-faithful + searchable**: the summary canvas DOM is rasterised via `html2canvas` at 2× DPI, embedded into the PDF page-by-page via `jspdf`. An invisible text layer (`renderingMode: 'invisible'`) is overlaid on top so the PDF is searchable and selectable while the bitmap preserves visual fidelity.
- **PDF page size matches canvas page size** (A4 / A3, portrait / landscape).
- **Reading order**: cells flow left-to-right, top-to-bottom (row-major with a y-tolerance for cells on the same visual row). An optional per-cell counter badge (schema field `showReadingOrderBadges`, default true) makes ambiguous cases visible.
- **Page-break straddle**: before capture, any cell whose bounding box would cross a page boundary is temporarily shifted down to the top of the next page. Cells already on the last page or taller than a single page are not pushed.
- **Link annotations**: anchor tags in the rendered DOM are overlaid as PDF link annotations on the right page, so URLs are clickable in the PDF reader. Clicking links in summary view also navigates (opens in a new tab).
- **Trade-off**: text glyphs in the visible PDF are rasterised. The invisible overlay covers search/selection. A future vector-text rewrite would reduce file size and produce sharper text.
- **Filename** defaults to `{notebook-basename}.pdf`.

### Technical Requirements

#### TR1: JupyterLab Integration
- **Extension Type**: Frontend extension using TypeScript
- **Architecture**: Plugin-based, hooks into existing cell widgets
- **Performance**: No noticeable impact on notebook performance
- **Compatibility**: JupyterLab 4.0+ support

_Implemented as:_ scaffolded with `copier` (the modern JupyterLab extension template; the spec's `cookiecutter` reference is now archived upstream). Verified against JupyterLab 4.3.4. Plugin requires `INotebookTracker` and optionally `ISettingRegistry`. Frontend-only — no server extension component.

#### TR2: Storage Format

_Updated to reflect the actual schema as of v0.1.0:_

```json
{
  "metadata": {
    "cell_layout": {
      "version": "1.0",
      "enabled": true,
      "settings": {
        "page_size": "A4",
        "orientation": "portrait",
        "page_count": 1,
        "grid_snap": 5,
        "default_summary_lines": 3,
        "notebook_mode": "edit",
        "smart_guides": true
      },
      "cells": {
        "{cell-id}": {
          "type": "code|markdown|raw",
          "mode": "summary|edit",
          "input": {
            "position": {"x": 100, "y": 200},
            "size": {"width": 400, "height": 150},
            "visible_lines": 3,
            "z_index": 1,
            "auto_fit": true
          },
          "outputs": [
            {
              "output_id": "output_a",
              "type": "text|graphics|mixed",
              "position": {"x": 100, "y": 360},
              "size": {"width": 400, "height": 200},
              "visible_lines": 10,
              "z_index": 2,
              "max_image_width": 380,
              "enabled": true,
              "auto_fit": true
            },
            {
              "output_id": "output_b",
              "type": "graphics|text|mixed",
              "position": {"x": 520, "y": 200},
              "size": {"width": 500, "height": 300},
              "visible_lines": null,
              "z_index": 3,
              "max_image_width": 480,
              "enabled": true,
              "auto_fit": true
            }
          ]
        }
      }
    }
  }
}
```

**Schema additions over the original spec:**

| Field | Purpose |
| --- | --- |
| `settings.page_size` | `"A4"` (default) or `"A3"`. |
| `settings.orientation` | `"portrait"` (default) or `"landscape"`. |
| `settings.page_count` | Integer, 1–20. Auto-grows when cells extend past the canvas; manual remove only. |
| `settings.notebook_mode` | `"summary"` or `"edit"` — replaces the per-cell mode toggle. |
| `input.auto_fit` | If `true`, the next markdown render measures rendered content and resizes the slot. Flips to `false` after first fit or manual resize. |
| `outputs[].auto_fit` | Same, for matplotlib / image outputs in slot B. |
| `settings.grid_snap` | In **millimetres** (default 5). The original spec implied pixels; reinterpreted as mm consistent with the rest of the geometry. |
| `settings.smart_guides` | Boolean (default `true`). When on, drag and resize show alignment guides and snap to nearby cell edges/centres and active-page edges/centres within a 2 mm tolerance. Smart-guide snap takes precedence over the grid; falls back to grid when no smart match. |

All position and size values are in **mm** (converted to CSS px at 96 DPI for rendering, to pt for PDF).

#### TR3: Performance Requirements
- **Rendering**: Smooth 60fps during drag/resize operations
- **Memory**: Minimal memory overhead for layout data
- **Loading**: No significant delay when opening notebooks with layout data

_Implemented as:_ Drag and resize use `pointerCapture` and direct DOM `style.left`/`style.top` writes — feels smooth in informal testing on small-to-medium notebooks. No formal perf measurement done; deferred until a notebook surfaces real sluggishness.

## Implementation Architecture

### Component Structure

#### Core Components
1. **CellLayoutPlugin** (`src/index.ts`): Main JupyterLab plugin entry point
2. **SummaryCellWidget** (`src/widgets/summary-cell.ts`): Logical wrapper around one cell — owns its input + output sub-widgets, returns them to the canvas, handles z-index sync
3. **SummaryInputCell** (`src/widgets/summary-input-cell.ts`): Lumino widget for one cell's input slot — renders code as `<pre>` or markdown via rendermime, handles drag/resize
4. **SummaryOutputCell** (`src/widgets/summary-output-cell.ts`): Lumino widget for one output slot (A or B) — renders streams, errors, html, images, svg
5. **LayoutCanvas** (`src/widgets/layout-canvas.ts`): The page-sized canvas widget; mounted into the notebook panel's BoxLayout, swaps with `panel.content` on mode toggle. Handles multi-page rendering and bring-to-front
6. **Draggable / Resizable** (`src/widgets/draggable.ts`, `resizable.ts`): Pure pointer-event helpers; reusable across input/output sub-widgets. Grid snap and page-bound clamping live here
7. **OutputProcessor** (`src/managers/output-processor.ts`): Pure functions that classify each `nbformat.IOutput` as text or graphics and route to slot A or B
8. **CellCoordinator** (`src/managers/cell-coordinator.ts`): Maps notebook cells to layout entries, computes default layouts, persists position/size/z-index updates, auto-grows page count
9. **MetadataManager** (`src/managers/metadata.ts`): Reads and writes `notebook.metadata.cell_layout`, normalises malformed input, supplies defaults
10. **PDFExporter** (`src/exporters/pdf-export.ts`): html2canvas + jspdf bitmap export with straddle adjustments, link annotations, and invisible-text overlay for searchability

The original spec's `LayoutManager` class was effectively split between `CellCoordinator` (per-notebook bookkeeping) and `LayoutCanvas` (rendering). No standalone `LayoutManager` was created.

#### File Structure (actual)

```
jupyterlab-cell-layout/
├── package.json
├── pyproject.toml
├── README.md
├── CLAUDE.md                      # this file
├── TASKS.md                       # live task ledger
├── install.sh                     # dev install script for new machines
├── src/
│   ├── index.ts                   # main plugin: command + toolbar wiring
│   ├── exporters/
│   │   └── pdf-export.ts
│   ├── managers/
│   │   ├── metadata.ts
│   │   ├── output-processor.ts
│   │   └── cell-coordinator.ts
│   ├── widgets/
│   │   ├── layout-canvas.ts
│   │   ├── summary-cell.ts
│   │   ├── summary-input-cell.ts
│   │   ├── summary-output-cell.ts
│   │   ├── draggable.ts
│   │   ├── resizable.ts
│   │   └── units.ts               # mm/px/pt conversion + grid snap
│   └── demo/
│       └── info-dialog.ts         # debug "show layout info" command
├── style/
│   ├── base.css                   # all styles (single-file)
│   └── index.css
├── schema/
│   └── plugin.json                # JL settings schema + keybindings
├── ui-tests/                      # Playwright integration tests
└── jupyterlab_cell_layout/        # generated Python wrapper for the labextension
```

The original spec proposed `src/styles/{base,summary-mode,output-cells}.css` and `widgets/layout-handles.ts`. Implementation collapsed CSS into a single `style/base.css` and put resize-handle creation inside `resizable.ts` rather than a separate file.

### Key Classes and Interfaces

The TypeScript source uses the names and shapes documented in `src/managers/metadata.ts`. Key types:

```typescript
type PageSize = 'A4' | 'A3';
type PageOrientation = 'portrait' | 'landscape';
type NotebookMode = 'summary' | 'edit';
type CellMode = 'summary' | 'edit';
type CellType = 'code' | 'markdown' | 'raw';
type OutputSlotId = 'output_a' | 'output_b';
type OutputClassification = 'text' | 'graphics' | 'mixed';

interface IPosition { x: number; y: number; }            // mm
interface ISize { width: number; height: number; }       // mm

interface IInputLayout {
  position: IPosition;
  size: ISize;
  visible_lines: number;     // retained for back-compat; not used at render
  z_index: number;
  auto_fit: boolean;
}

interface IOutputLayout {
  output_id: OutputSlotId;
  type: OutputClassification;
  position: IPosition;
  size: ISize;
  visible_lines: number | null;
  z_index: number;
  max_image_width: number;   // mm; legacy, unused at render time
  enabled: boolean;
  auto_fit: boolean;
}

interface ICellLayout {
  type: CellType;
  mode: CellMode;             // "summary" = include on canvas, "edit" = exclude
  input: IInputLayout;
  outputs: IOutputLayout[];   // 0..2 entries
}

interface ILayoutSettings {
  page_size: PageSize;
  orientation: PageOrientation;
  page_count: number;
  grid_snap: number;
  default_summary_lines: number;
  notebook_mode: NotebookMode;
}

interface INotebookLayout {
  version: string;
  enabled: boolean;
  settings: ILayoutSettings;
  cells: Record<string, ICellLayout>;
}
```

`OutputProcessor` exposes a pure `route(outputs)` function rather than the spec's `processOutput` / `assignToCell` pair.

## Development Phases

### Phase 1: Core Infrastructure — ✅ Delivered
- Extension scaffold (copier template), editable pip install, dev labextension symlink.
- `MetadataManager` with full normalize-on-read for malformed metadata.
- `OutputProcessor` with the text/graphics routing rule and unit tests.
- `CellCoordinator` connecting notebook cells to layout entries.
- Read-only summary-mode rendering: `SummaryInputCell`, `SummaryOutputCell`, `SummaryCellWidget`, `LayoutCanvas`.
- Notebook-wide mode toggle bound to `Ctrl+Shift+T`.
- Per-cell include/exclude command bound to `Ctrl+Shift+E`.
- Page-size + orientation settings (A4 / A3 / portrait / landscape).
- Manual + 1-of-7 Playwright tests passing (other 6 blocked by an upstream Galata path-handling issue with `page.notebook.createNew`).

### Phase 2: Layout Management — ✅ Delivered
- Pointer-event drag for input and output slots, with mm-rounded persistence.
- 8-handle resize (4 corners + 4 edges) with min-size clamping, origin-edge clamping, and aspect-preserving image scaling via `object-fit: contain`.
- Click-to-front z-index management at the cell-group level (input + outputs share a layer).
- Grid snap on both drag and resize, value read live from settings on each pointer event.
- 100 Jest unit tests covering geometry, normalization, routing, snapping, and layout helpers.

### Phase 3: Polish + PDF Export — ✅ Core delivered
- **Polish round 1**: markdown via rendermime, image scaling, cell labels (1, 2 / 1A, 1B), overflow-clip code inputs.
- **Polish round 2**: auto-fit slots to image natural size on first render (markdown + matplotlib).
- **Multi-page canvas**: 1–20 pages stacked vertically with dashed page-break guides and "Page N of M" badges in the bottom-right of each page; page-count toolbar button (click adds, shift-click removes); auto-grow when cells extend past the canvas.
- **PDF export**: bitmap-faithful via html2canvas + jspdf, with page-straddle push, clickable link annotations, and an invisible text layer for searchability.
- **Polish round 3**: auto-grow page count, toolbar button spacing.
- 118 Jest tests passing.

### Phase 4: Advanced Features — 🟡 Partial
- **Smart alignment guides** ✅ shipped: during drag and resize, snap to nearby cell edges and centres plus active-page edges and centres within a 2 mm tolerance. Same-page only — no cross-page snapping. Smart-guide snap takes precedence over the grid; falls back to grid when no smart match. User-configurable via the `smartGuides` setting (default on). Resize snaps the moving edge only and excludes centre candidates — aligning a moving edge to a sibling centre rarely matches intent.
- **Layout templates**, **bulk operations**, **full keyboard navigation**: not started. Plus the deferred items called out in the Implementation Status table at the top of this document.

## Technical Specifications

### Dependencies (actual `package.json` runtime deps)
```json
{
  "@jupyterlab/application": "^4.3.0",
  "@jupyterlab/apputils": "^4.3.0",
  "@jupyterlab/cells": "^4.3.0",
  "@jupyterlab/nbformat": "^4.3.0",
  "@jupyterlab/notebook": "^4.3.0",
  "@jupyterlab/rendermime": "^4.3.0",
  "@jupyterlab/settingregistry": "^4.3.0",
  "@lumino/dragdrop": "^2.0.0",
  "@lumino/widgets": "^2.0.0",
  "html2canvas": "^1.4.1",
  "jspdf": "^2.5.2"
}
```

The original spec listed `react` and `react-dom`. React is not used — all rendering is via Lumino widgets and direct DOM. `@jupyterlab/rendermime` was added for markdown rendering with proper URL resolution. `@jupyterlab/apputils` supplies `ToolbarButton` and `Dialog`. `jspdf` and `html2canvas` are the PDF export pipeline.

### Build Configuration
- **Bundler**: Webpack via JupyterLab's federated extensions
- **TypeScript**: strict mode, `src/**/*` included
- **CSS**: a single `style/base.css` (no preprocessor)
- **Testing**: Jest for unit tests (`jlpm test`), Playwright + Galata for integration tests (`ui-tests/`)

### API Design

The plugin's actual signature:
```typescript
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-cell-layout:plugin',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ISettingRegistry],
  activate: (app, notebooks, settingRegistry) => { /* ... */ }
};
```

Per-notebook state is held in a `WeakMap<NotebookPanel, INotebookState>` containing the manager, coordinator, canvas, and the four toolbar buttons. There is no public LayoutManager class; equivalent functions live on `CellCoordinator` (e.g. `updateInputLayout`, `setCellZIndex`, `ensureEnoughPages`) and `LayoutCanvas` (e.g. `bringCellToFront`, `refresh`).

### Commands and shortcuts (actual)

| Command id | Default shortcut | Purpose |
| --- | --- | --- |
| `jupyterlab-cell-layout:toggle-mode` | `Ctrl+Shift+T` | Notebook-wide summary / edit toggle |
| `jupyterlab-cell-layout:toggle-cell-inclusion` | `Ctrl+Shift+E` | Include / exclude active cell from canvas |
| `jupyterlab-cell-layout:toggle-orientation` | _(palette only)_ | Portrait / landscape |
| `jupyterlab-cell-layout:add-page` | `Ctrl+Shift+]` | Append a page |
| `jupyterlab-cell-layout:remove-page` | `Ctrl+Shift+[` | Remove last page |
| `jupyterlab-cell-layout:export-pdf` | _(palette only)_ | Export PDF |
| `jupyterlab-cell-layout:show-info` | _(palette only)_ | Debug dialog with layout state |

Toolbar adds four buttons at positions 10–13: **Edit/Summary mode**, **Portrait/Landscape**, **N pages**, **Export PDF**.

## Quality Assurance

### Testing Strategy
- **Unit Tests**: 118 Jest tests across managers, exporters, and widget helpers — covering normalization, routing, geometry, snapping, page-count math, and PDF straddle math.
- **Integration Tests**: Playwright + Galata. 1 test (extension activation) reliably passes; the rest hit an upstream Galata path-handling bug in `page.notebook.createNew()` that prepends the server's working directory twice. Tests are committed in `ui-tests/tests/jupyterlab_cell_layout.spec.ts` for when Galata is fixed or worked around.
- **Visual Tests**: manual; described in `TASKS.md` and the README.
- **Performance Tests**: not formalised. Manual evidence so far: small notebooks (≤ 10 cells) render and drag smoothly.

### Browser Support
- Chrome / Brave / Edge 90+
- Firefox 88+
- Safari 14+

### Accessibility
Keyboard nav is partial — Ctrl+Shift+T/E/]/[ work, but full Tab/arrow-key navigation through cells is part of Phase 4.

## Deployment and Distribution

Installation is via the development workflow in `install.sh`:
```bash
git clone https://github.com/lewis-jeffery/jupyterlab-cell-layout.git
cd jupyterlab-cell-layout
./install.sh   # pip install -e . + jupyter labextension develop --overwrite
jupyter lab
```

Publishing to PyPI / conda-forge is a future activity; not done in v0.1.0.

## Configuration Options

### User Settings (`schema/plugin.json` keys)
```json
{
  "jupyterlab-cell-layout": {
    "pageSize": "A4",
    "orientation": "portrait",
    "defaultSummaryLines": 3,
    "gridSnap": 5,
    "showReadingOrderBadges": true,
    "smartGuides": true
  }
}
```

These are the JL global defaults seeded into a brand-new notebook's metadata; existing notebooks keep whatever they have. The original spec also listed `enableGridSnap`, `animationDuration`, `showLayoutHandles`, `pdfExportDPI` — none implemented (animation is omitted, layout handles fade in on hover, PDF DPI is hard-coded to 2× capture scale).

## Success Metrics

### Functional Metrics
- All cells can toggle between modes without data loss ✅
- Layout persists across notebook sessions ✅
- PDF export maintains visual structure ✅
- PDF text searchable via invisible overlay ✅ (added during implementation)
- Zero conflicts with standard JupyterLab workflows ✅ (notebooks open identically in stock JL)

### Performance Metrics
- < 100ms response time for mode toggle — **subjectively yes** (no measurement)
- < 16ms frame time during drag operations — **subjectively yes** (no measurement)
- < 5% memory overhead for layout data — not measured
- < 2s PDF generation time for typical notebooks — **yes** (~0.5–1.5 s observed for 1–3 page notebooks)

### Quality Metrics
- 95% test coverage — not yet (118 tests, focused on pure logic; widget rendering not covered)
- Compatible with latest JupyterLab versions — pinned to `^4.3.0`, tested on 4.3.4

## Risk Assessment

### Technical Risks (post-implementation notes)
- **JupyterLab API Changes**: pinning to `^4.3.0` keeps us on a single major. Galata's path handling already bit us in the test-tooling layer.
- **PDF Export Complexity**: started with bitmap (simple), added invisible text layer (still simple). Vector-text would be the next jump and would also fix the link-click regression.
- **Pointerdown vs click interaction**: drag handlers that call `preventDefault()` on `pointerdown` for a node also suppress the synthesized `click` event for every descendant — this broke markdown-link navigation (#28, fixed). Anchors with navigable hrefs now bypass drag init in `draggable.ts`.

### User Experience Risks
- **Mode Confusion**: addressed by notebook-wide toggle and labelled toolbar buttons.
- **Layout Corruption**: addressed by `MetadataManager.normalize*` functions that fall back gracefully on every malformed field.
- **Learning Curve**: README + TASKS.md + this spec document the model. No video walkthrough yet.

## Future Enhancements

### Potential Features (still relevant)
- Layout templates and themes (Phase 4 item).
- Vector-text PDF (would supersede the invisible-text overlay and produce sharper text).
- Bulk multi-cell drag (Phase 4 item).
- Full keyboard navigation parity (Phase 4 item).
- "Delete a specific page" command for middle-of-document pages.
- Cover sheet generator for formal PDF deliveries (#26 deferred).
- In-canvas table of contents sidebar (#27 deferred).

### Extension Points
- Plugin API for custom layout behaviors — not exposed yet; everything is internal classes.
- Theming via CSS variables (`--jp-*`) is partial; works for colours and fonts.
- Export format plugins (PowerPoint etc.) — not designed; would extend `src/exporters/`.
- Integration with version control systems — handled by JSON metadata diff-friendliness.
